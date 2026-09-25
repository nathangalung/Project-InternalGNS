package quotations

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/pdfgen"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/tz"
	"github.com/nathangalung/internalgns/apps/api/internal/units"
)

// ExportHandler renders a quotation PDF.
type ExportHandler struct {
	repo     *Repo
	clients  *clients.Repo
	units    *units.Repo
	renderer *pdfgen.Renderer
	settings deps.PdfSettings
}

// NewExportHandler wires PDF export repos.
func NewExportHandler(repo *Repo, c *clients.Repo, u *units.Repo, r *pdfgen.Renderer, s deps.PdfSettings) *ExportHandler {
	return &ExportHandler{repo: repo, clients: c, units: u, renderer: r, settings: s}
}

type exportItem struct {
	No        int
	Qty       string
	Unit      string
	Request   string
	Offer     string
	HasOffer  bool
	UnitPrice string
	Amount    string
}

type exportData struct {
	QuotationNo   string
	ClientRefNo   string
	CompanyName   string
	AttnName      string
	AttnEmail     string
	AttnPhone     string
	DateLine      string
	Items         []exportItem
	TotalProduk   string
	DiscountPct   string
	TotalDiscount string
	Shipping      string
	HasShipping   bool
	Subtotal      string
	DPP           string
	PPN           string
	GrandTotal    string
	DeliveryPlace string
	DeliveryTime  string
	Payment       string
	Validity      string
	SignerName    string
	UseA4         bool
}

// ExportPDF streams the quotation PDF.
func (h *ExportHandler) ExportPDF(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}

	d, err := h.repo.GetDetail(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("quotation not found"))
		return
	}
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}

	data, err := h.buildData(r.Context(), d)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}

	pdf, err := h.renderer.Render(r.Context(), "quotation/Quotation.tex.tmpl", data)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}

	if werr := pdfgen.WritePDFResponse(w, d.QuotationNo, pdf); werr != nil {
		slog.WarnContext(r.Context(), "pdf write failed", "doc", "quotation", "id", id, "err", werr)
	}
}

func (h *ExportHandler) buildData(ctx context.Context, d QuotationDetail) (exportData, error) {
	unitsByID, err := h.unitsLookup(ctx)
	if err != nil {
		return exportData{}, err
	}

	client, _ := h.clients.GetByID(ctx, d.CompanyClientID)
	contactEmail, contactPhone := h.contactComm(ctx, d, client)

	return buildExportData(d, unitsByID, contactEmail, contactPhone, h.settings.SignerName), nil
}

// buildExportData shapes the template data.
func buildExportData(
	d QuotationDetail, unitsByID map[int16]string, contactEmail, contactPhone, signerName string,
) exportData {
	// Every total is the stored header, so the app, the PDF and the
	// invoice agree. An unpriced line is No Offer: it adds nothing to
	// total_produk and P0100 refuses to send it.
	items := make([]exportItem, 0, len(d.Items))
	productCount := 0
	hasShipping := false
	// fn_create_quotation writes at most one shipping line.
	deliveryTime := ""

	for _, it := range d.Items {
		unitCode := ""
		if it.UnitID != nil {
			unitCode = unitsByID[*it.UnitID]
		}
		shipping := it.ItemType == "shipping"
		if shipping {
			if it.ShippingDays != nil {
				deliveryTime = daysText(*it.ShippingDays)
			}
			// A line kept only for its address is no charge.
			if !isPriced(it.SellingPrice) {
				continue
			}
			hasShipping = true
		} else {
			productCount++
		}

		items = append(items, exportItem{
			No:        len(items) + 1,
			Qty:       pdfgen.FormatQty(it.Qty),
			Unit:      pdfgen.LatexEscape(unitCode),
			Request:   withCode(it.RequestedName, it.RequestedImpa),
			Offer:     offerText(it),
			HasOffer:  shipping || isPriced(it.SellingPrice),
			UnitPrice: pdfgen.FormatIDRCents(it.SellingPrice),
			Amount:    pdfgen.FormatIDRCents(it.TotalSelling),
		})
	}

	delivery := ""
	if d.VesselName != nil {
		delivery = *d.VesselName
	}
	payment := ""
	if d.PaymentTerms != nil {
		payment = *d.PaymentTerms
	}
	validity := ""
	if d.ValidityDays != nil {
		validity = daysText(*d.ValidityDays)
	}
	attn := ""
	if d.ContactName != nil {
		attn = *d.ContactName
	}

	return exportData{
		QuotationNo:   pdfgen.LatexEscape(d.QuotationNo),
		ClientRefNo:   pdfgen.LatexEscape(pdfgen.StrDeref(d.ClientRefNo)),
		CompanyName:   pdfgen.LatexEscape(d.CompanyClientName),
		AttnName:      pdfgen.LatexEscape(attn),
		AttnEmail:     pdfgen.LatexEscape(contactEmail),
		AttnPhone:     pdfgen.LatexEscape(contactPhone),
		DateLine:      pdfgen.JakartaDateLine(d.CreatedAt.In(tz.Jakarta())),
		Items:         items,
		TotalProduk:   pdfgen.FormatIDRCents(d.TotalProduk),
		DiscountPct:   d.DiscountPct,
		TotalDiscount: pdfgen.FormatIDRCents(d.TotalDiscount),
		Shipping:      pdfgen.FormatIDRCents(pdfgen.BigSub(d.Total, d.TotalProduk)),
		HasShipping:   hasShipping,
		Subtotal:      pdfgen.FormatIDRCents(d.Subtotal),
		DPP:           pdfgen.FormatIDRCents(d.DppNilaiLain),
		PPN:           pdfgen.FormatIDRCents(d.PpnAmount),
		GrandTotal:    pdfgen.FormatIDRCents(d.GrandTotal),
		DeliveryPlace: pdfgen.LatexEscape(delivery),
		DeliveryTime:  pdfgen.LatexEscape(deliveryTime),
		Payment:       pdfgen.LatexEscape(payment),
		Validity:      pdfgen.LatexEscape(validity),
		SignerName:    pdfgen.LatexEscape(signerName),
		UseA4:         productCount > 5,
	}
}

// offerText names the supplied item.
func offerText(it QuotationItem) string {
	if it.OfferedName != nil && *it.OfferedName != "" {
		return withCode(*it.OfferedName, it.OfferedImpa)
	}
	return withCode(it.RequestedName, nil)
}

// withCode appends the IMPA code.
// Both parts may wrap, since table cells are narrow.
func withCode(name string, code *string) string {
	out := pdfgen.LatexBreakable(name)
	if code != nil && *code != "" {
		out += " (" + pdfgen.LatexBreakable(*code) + ")"
	}
	return out
}

func (h *ExportHandler) unitsLookup(ctx context.Context) (map[int16]string, error) {
	all, err := h.units.ListAll(ctx)
	if err != nil {
		return nil, err
	}
	out := make(map[int16]string, len(all))
	for _, u := range all {
		out[u.ID] = u.Code
	}
	return out, nil
}

func (h *ExportHandler) contactComm(ctx context.Context, d QuotationDetail, c clients.Client) (string, string) {
	if d.ContactID == nil {
		return pdfgen.StrDeref(c.ContactEmail), pdfgen.StrDeref(c.ContactPhone)
	}
	contacts, err := h.clients.ListContacts(ctx, d.CompanyClientID)
	if err != nil {
		return pdfgen.StrDeref(c.ContactEmail), pdfgen.StrDeref(c.ContactPhone)
	}
	for _, ct := range contacts {
		if ct.ID == *d.ContactID {
			return pdfgen.StrDeref(ct.Email), pdfgen.StrDeref(ct.Phone)
		}
	}
	return pdfgen.StrDeref(c.ContactEmail), pdfgen.StrDeref(c.ContactPhone)
}

// isPriced reports a positive price.
func isPriced(price string) bool {
	v, err := strconv.ParseFloat(price, 64)
	return err == nil && v > 0
}

// daysText renders a day count.
func daysText(n int) string {
	if n == 1 {
		return "1 day"
	}
	return strconv.Itoa(n) + " days"
}
