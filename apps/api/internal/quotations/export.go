package quotations

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/pdfgen"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/money"
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

// NewExportHandler wires repos for PDF export.
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
	Subtotal      string
	DPP           string
	PPN           string
	GrandTotal    string
	DeliveryPlace string
	DeliveryTime  string
	Payment       string
	Validity      string
	SignerName    string
}

// ExportPDF returns the quotation as a PDF stream.
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

	items := make([]exportItem, 0, len(d.Items))
	for i, it := range d.Items {
		unitCode := ""
		if it.UnitID != nil {
			unitCode = unitsByID[*it.UnitID]
		}
		req := pdfgen.LatexEscape(it.RequestedName)
		if it.RequestedImpa != nil && *it.RequestedImpa != "" {
			req += " (" + pdfgen.LatexEscape(*it.RequestedImpa) + ")"
		}
		hasOffer := it.IsAvailable && it.OfferedItemID != nil
		items = append(items, exportItem{
			No:        i + 1,
			Qty:       pdfgen.FormatQty(it.Qty),
			Unit:      pdfgen.LatexEscape(unitCode),
			Request:   req,
			Offer:     pdfgen.LatexEscape(it.RequestedName),
			HasOffer:  hasOffer,
			UnitPrice: pdfgen.FormatIDR(it.SellingPrice),
			Amount:    pdfgen.FormatIDR(it.TotalSelling),
		})
	}

	subtotal := pdfgen.BigSub(d.TotalProduk, d.TotalDiscount)
	dpp := pdfgen.BigMulDiv(subtotal, money.DPPNumeratorStr, money.DPPDenominatorStr)
	ppn := pdfgen.BigMul(dpp, money.PPNRateStr)

	delivery := ""
	deliveryTime := ""
	if d.VesselName != nil {
		delivery = *d.VesselName
	}
	payment := ""
	if d.PaymentTerms != nil {
		payment = *d.PaymentTerms
	}
	validity := ""
	if d.ValidityDays != nil {
		validity = strconv.Itoa(*d.ValidityDays) + " days"
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
		DateLine:      pdfgen.JakartaDateLine(d.CreatedAt.In(time.Local)),
		Items:         items,
		TotalProduk:   pdfgen.FormatIDR(d.TotalProduk),
		DiscountPct:   d.DiscountPct,
		TotalDiscount: pdfgen.FormatIDR(d.TotalDiscount),
		Subtotal:      pdfgen.FormatIDR(subtotal),
		DPP:           pdfgen.FormatIDR(dpp),
		PPN:           pdfgen.FormatIDR(ppn),
		GrandTotal:    pdfgen.FormatIDR(d.Total),
		DeliveryPlace: pdfgen.LatexEscape(delivery),
		DeliveryTime:  pdfgen.LatexEscape(deliveryTime),
		Payment:       pdfgen.LatexEscape(payment),
		Validity:      pdfgen.LatexEscape(validity),
		SignerName:    pdfgen.LatexEscape(h.settings.SignerName),
	}, nil
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

