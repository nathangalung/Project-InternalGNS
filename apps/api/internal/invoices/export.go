package invoices

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/pdfgen"
	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/tz"
)

// ExportHandler renders an invoice PDF.
type ExportHandler struct {
	repo       *Repo
	clients    *clients.Repo
	quotations *quotations.Repo
	pos        *purchaseorders.Repo
	renderer   *pdfgen.Renderer
	settings   deps.PdfSettings
}

func NewExportHandler(
	repo *Repo,
	c *clients.Repo,
	q *quotations.Repo,
	po *purchaseorders.Repo,
	r *pdfgen.Renderer,
	s deps.PdfSettings,
) *ExportHandler {
	return &ExportHandler{repo: repo, clients: c, quotations: q, pos: po, renderer: r, settings: s}
}

type exportItem struct {
	No          int
	Qty         string
	Unit        string
	Name        string
	Description string
	UnitPrice   string
	Amount      string
}

type exportData struct {
	InvoiceNo       string
	PONo            string
	PODate          string
	CompanyName     string
	CompanyNPWP     string
	CompanyAddress  string
	VesselName      string
	InvoiceDate     string
	DueDate         string
	Items           []exportItem
	TotalProduk     string
	Diskon          string
	DiscountPct     string
	DPP             string
	DPPNilaiLain    string
	PPN             string
	Total           string
	PaymentTerms    string
	BankName        string
	BankAccountNo   string
	BankAccountName string
	DateLine        string
	SignerName      string
	UseA4           bool
}

func (h *ExportHandler) ExportPDF(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}

	inv, err := h.repo.GetByID(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("invoice not found"))
		return
	}
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}

	items, err := h.repo.ListItems(r.Context(), id)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}

	data := h.buildData(r.Context(), inv, items)

	pdf, err := h.renderer.Render(r.Context(), "invoice/Invoice.tex.tmpl", data)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}

	if werr := pdfgen.WritePDFResponse(w, inv.InvoiceNo, pdf); werr != nil {
		slog.WarnContext(r.Context(), "pdf write failed", "doc", "invoice", "id", id, "err", werr)
	}
}

func (h *ExportHandler) buildData(ctx context.Context, inv Invoice, items []InvoiceItem) exportData {
	client, _ := h.clients.GetByID(ctx, inv.CompanyClientID)

	vessel := ""
	diskon := ""
	discountPct := ""
	if q, err := h.quotations.GetDetail(ctx, inv.QuotationID); err == nil {
		if q.VesselName != nil {
			vessel = *q.VesselName
		}
		// Only set when numerically non-zero
		if v, _ := strconv.ParseFloat(q.TotalDiscount, 64); v != 0 {
			diskon = q.TotalDiscount
			discountPct = q.DiscountPct
		}
	}

	poNo := ""
	poDate := ""
	if inv.PoID != nil {
		if po, err := h.pos.GetByID(ctx, *inv.PoID); err == nil {
			poNo = po.PoNumber
			poDate = po.PoDate.Format("2 January 2006")
		}
	}

	expItems := make([]exportItem, 0, len(items))
	totalProdukStr := "0"
	productCount := 0
	for i, it := range items {
		unit := ""
		if it.UnitCode != nil {
			unit = *it.UnitCode
		}
		amt := pdfgen.BigMul(it.Qty, it.UnitPrice)
		if it.LineType == "product" {
			productCount++
			totalProdukStr = pdfgen.BigAdd(totalProdukStr, amt)
		}
		desc := ""
		if it.ShipDestination != nil {
			desc = *it.ShipDestination
		}
		expItems = append(expItems, exportItem{
			No:          i + 1,
			Qty:         pdfgen.FormatQty(it.Qty),
			Unit:        pdfgen.LatexEscape(unit),
			Name:        pdfgen.LatexEscape(it.ItemName),
			Description: pdfgen.LatexEscape(desc),
			UnitPrice:   pdfgen.FormatIDR(it.UnitPrice),
			Amount:      pdfgen.FormatIDR(amt),
		})
	}

	dueDate := ""
	if inv.DueDate != nil {
		dueDate = inv.DueDate.Format("2 January 2006")
	}

	return exportData{
		InvoiceNo:      pdfgen.LatexEscape(inv.InvoiceNo),
		PONo:           pdfgen.LatexEscape(poNo),
		PODate:         poDate,
		CompanyName:    pdfgen.LatexEscape(inv.CompanyName),
		CompanyNPWP:    pdfgen.LatexEscape(pdfgen.StrDeref(client.NPWP)),
		CompanyAddress: pdfgen.LatexEscape(pdfgen.StrDeref(client.Address)),
		VesselName:     pdfgen.LatexEscape(vessel),
		InvoiceDate:    inv.InvoiceDate.Format("2 January 2006"),
		DueDate:        dueDate,
		Items:          expItems,
		TotalProduk:    pdfgen.FormatIDR(totalProdukStr),
		Diskon: func() string {
			if diskon == "" {
				return ""
			}
			return pdfgen.FormatIDR(diskon)
		}(),
		DiscountPct:     discountPct,
		DPP:             pdfgen.FormatIDR(pdfgen.StrDeref(inv.Dpp)),
		DPPNilaiLain:    pdfgen.FormatIDR(pdfgen.StrDeref(inv.DppNilaiLain)),
		PPN:             pdfgen.FormatIDR(pdfgen.StrDeref(inv.PpnAmount)),
		Total:           pdfgen.FormatIDR(pdfgen.StrDeref(inv.Total)),
		PaymentTerms:    pdfgen.LatexEscape(h.settings.PaymentTerms),
		BankName:        pdfgen.LatexEscape(h.settings.BankName),
		BankAccountNo:   pdfgen.LatexEscape(h.settings.BankAccountNo),
		BankAccountName: pdfgen.LatexEscape(h.settings.BankAccountNm),
		DateLine:        pdfgen.JakartaDateLine(inv.InvoiceDate.In(tz.Jakarta())),
		SignerName:      pdfgen.LatexEscape(h.settings.SignerName),
		UseA4:           productCount > 5,
	}
}
