package invoices

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/pdfgen"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/tz"
)

// ExportHandler renders an invoice PDF.
// The detail row carries the buyer, PO and vessel, so a failed read is an
// error, never a PDF with blank parties.
type ExportHandler struct {
	repo     *Repo
	renderer *pdfgen.Renderer
	settings deps.PdfSettings
}

func NewExportHandler(repo *Repo, r *pdfgen.Renderer, s deps.PdfSettings) *ExportHandler {
	return &ExportHandler{repo: repo, renderer: r, settings: s}
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
	InvoiceNo         string
	ReplacesInvoiceNo string
	Cancelled         bool
	PONo              string
	PODate            string
	CompanyName       string
	CompanyNPWP       string
	CompanyAddress    string
	VesselName        string
	InvoiceDate       string
	DueDate           string
	Items             []exportItem
	TotalProduk       string
	Diskon            string
	DPP               string
	DPPNilaiLain      string
	PPN               string
	Total             string
	PaymentTerms      string
	BankName          string
	BankAccountNo     string
	BankAccountName   string
	DateLine          string
	SignerName        string
}

func (h *ExportHandler) ExportPDF(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}

	det, err := h.repo.documentHeader(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("invoice not found"))
		return
	}
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}

	items, err := h.repo.ListItems(r.Context(), id)
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}

	pdf, err := h.renderer.Render(r.Context(), "invoice/Invoice.tex.tmpl", h.buildData(det, items))
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}

	if werr := pdfgen.WritePDFResponse(w, det.InvoiceNo, pdf); werr != nil {
		slog.WarnContext(r.Context(), "pdf write failed", "doc", "invoice", "id", id, "err", werr)
	}
}

// buildData maps one invoice.
// A cancelled invoice still prints, marked DIBATALKAN, and a Pengganti
// names the invoice it replaces.
func (h *ExportHandler) buildData(det InvoiceDetail, items []InvoiceItem) exportData {
	// Discount comes from the invoice snapshot, not the quotation: it is the
	// realised per-line discount, so TotalProduk - Diskon = DPP by construction.
	diskon := ""
	if det.TotalDiscount != nil {
		if v, _ := strconv.ParseFloat(*det.TotalDiscount, 64); v != 0 {
			diskon = pdfgen.FormatIDRCents(*det.TotalDiscount)
		}
	}

	poDate := ""
	if det.PoDate != nil {
		poDate = det.PoDate.Format("2 January 2006")
	}

	expItems := make([]exportItem, 0, len(items))
	totalProdukStr := "0"
	for i, it := range items {
		unit := ""
		if it.UnitCode != nil {
			unit = *it.UnitCode
		}
		// Print the gross price; the discount is a separate row. Historical
		// rows predate the snapshot and fall back to the net unit price.
		gross := it.UnitPrice
		if it.GrossUnitPrice != nil {
			gross = *it.GrossUnitPrice
		}
		amt := pdfgen.BigMul(it.Qty, gross)
		// HARGA TOTAL spans every line, shipping included, so that
		// TotalProduk - Diskon lands exactly on DPP.
		totalProdukStr = pdfgen.BigAdd(totalProdukStr, amt)
		expItems = append(expItems, exportItem{
			No:          i + 1,
			Qty:         pdfgen.FormatQty(it.Qty),
			Unit:        pdfgen.LatexEscape(unit),
			Name:        pdfgen.LatexBreakable(it.ItemName),
			Description: pdfgen.LatexAddress(pdfgen.StrDeref(it.ShipDestination), pdfgen.CellKeep),
			UnitPrice:   pdfgen.FormatIDRCents(gross),
			Amount:      pdfgen.FormatIDRCents(amt),
		})
	}

	dueDate := ""
	if det.DueDate != nil {
		dueDate = det.DueDate.Format("2 January 2006")
	}

	return exportData{
		InvoiceNo:         pdfgen.LatexEscape(det.InvoiceNo),
		ReplacesInvoiceNo: pdfgen.LatexEscape(pdfgen.StrDeref(det.ReplacesInvoiceNo)),
		Cancelled:         det.Status == StatusCancelled,
		PONo:              pdfgen.LatexEscape(pdfgen.StrDeref(det.PoNumber)),
		PODate:            poDate,
		CompanyName:       pdfgen.LatexBreakable(det.CompanyName),
		CompanyNPWP:       pdfgen.LatexEscape(pdfgen.StrDeref(det.CompanyNpwp)),
		CompanyAddress:    pdfgen.LatexAddress(pdfgen.StrDeref(det.CompanyAddress), pdfgen.PartyKeep),
		VesselName:        pdfgen.LatexEscape(pdfgen.StrDeref(det.VesselName)),
		InvoiceDate:       det.InvoiceDate.Format("2 January 2006"),
		DueDate:           dueDate,
		Items:             expItems,
		TotalProduk:       pdfgen.FormatIDRCents(totalProdukStr),
		Diskon:            diskon,
		DPP:               pdfgen.FormatIDRCents(pdfgen.StrDeref(det.Dpp)),
		DPPNilaiLain:      pdfgen.FormatIDRCents(pdfgen.StrDeref(det.DppNilaiLain)),
		PPN:               pdfgen.FormatIDRCents(pdfgen.StrDeref(det.PpnAmount)),
		Total:             pdfgen.FormatIDRCents(pdfgen.StrDeref(det.Total)),
		PaymentTerms:      pdfgen.LatexEscape(h.settings.PaymentTerms),
		BankName:          pdfgen.LatexEscape(h.settings.BankName),
		BankAccountNo:     pdfgen.LatexEscape(h.settings.BankAccountNo),
		BankAccountName:   pdfgen.LatexEscape(h.settings.BankAccountNm),
		DateLine:          pdfgen.JakartaDateLine(det.InvoiceDate.In(tz.Jakarta())),
		SignerName:        pdfgen.LatexEscape(h.settings.SignerName),
	}
}
