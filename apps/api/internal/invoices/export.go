package invoices

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/pdfgen"
	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
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
	CompanyName     string
	CompanyNPWP     string
	CompanyAddress  string
	VesselName      string
	InvoiceDate     string
	DueDate         string
	Items           []exportItem
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
		httperr.Render(w, httperr.Internal(err.Error()))
		return
	}

	items, err := h.repo.ListItems(r.Context(), id)
	if err != nil {
		httperr.Render(w, httperr.Internal(err.Error()))
		return
	}

	data, err := h.buildData(r.Context(), inv, items)
	if err != nil {
		httperr.Render(w, httperr.Internal(err.Error()))
		return
	}

	pdf, err := h.renderer.Render(r.Context(), "invoice/Invoice.tex.tmpl", data)
	if err != nil {
		httperr.Render(w, httperr.Internal(err.Error()))
		return
	}

	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`inline; filename="%s.pdf"`, sanitizeFilename(inv.InvoiceNo)))
	_, _ = w.Write(pdf)
}

func (h *ExportHandler) buildData(ctx context.Context, inv Invoice, items []InvoiceItem) (exportData, error) {
	client, _ := h.clients.GetByID(ctx, inv.CompanyClientID)

	vessel := ""
	if q, err := h.quotations.GetDetail(ctx, inv.QuotationID); err == nil {
		if q.VesselName != nil {
			vessel = *q.VesselName
		}
	}

	poNo := ""
	if inv.PoID != nil {
		if po, err := h.pos.GetByID(ctx, *inv.PoID); err == nil {
			poNo = po.PoNumber
		}
	}

	expItems := make([]exportItem, 0, len(items))
	for i, it := range items {
		unit := ""
		if it.UnitCode != nil {
			unit = *it.UnitCode
		}
		amt := mulNumStr(it.Qty, it.UnitPrice)
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
		InvoiceNo:       pdfgen.LatexEscape(inv.InvoiceNo),
		PONo:            pdfgen.LatexEscape(poNo),
		CompanyName:     pdfgen.LatexEscape(inv.CompanyName),
		CompanyNPWP:     pdfgen.LatexEscape(strDeref(client.NPWP)),
		CompanyAddress:  pdfgen.LatexEscape(strDeref(client.Address)),
		VesselName:      pdfgen.LatexEscape(vessel),
		InvoiceDate:     inv.InvoiceDate.Format("2 January 2006"),
		DueDate:         dueDate,
		Items:           expItems,
		DPP:             pdfgen.FormatIDR(strDeref(inv.Dpp)),
		DPPNilaiLain:    pdfgen.FormatIDR(strDeref(inv.DppNilaiLain)),
		PPN:             pdfgen.FormatIDR(strDeref(inv.PpnAmount)),
		Total:           pdfgen.FormatIDR(strDeref(inv.Total)),
		PaymentTerms:    pdfgen.LatexEscape(h.settings.PaymentTerms),
		BankName:        pdfgen.LatexEscape(h.settings.BankName),
		BankAccountNo:   pdfgen.LatexEscape(h.settings.BankAccountNo),
		BankAccountName: pdfgen.LatexEscape(h.settings.BankAccountNm),
		DateLine:        pdfgen.JakartaDateLine(inv.InvoiceDate.In(time.Local)),
		SignerName:      pdfgen.LatexEscape(h.settings.SignerName),
	}, nil
}

func strDeref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// mulNumStr multiplies two numeric strings to 2-decimal output.
func mulNumStr(a, b string) string {
	x, errA := strconv.ParseFloat(zero(a), 64)
	y, errB := strconv.ParseFloat(zero(b), 64)
	if errA != nil || errB != nil {
		return "0"
	}
	return strconv.FormatFloat(x*y, 'f', 2, 64)
}

func zero(s string) string {
	if s == "" {
		return "0"
	}
	return s
}

func sanitizeFilename(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z',
			r >= 'A' && r <= 'Z',
			r >= '0' && r <= '9',
			r == '-' || r == '_' || r == '.':
			out = append(out, r)
		default:
			out = append(out, '_')
		}
	}
	if len(out) == 0 {
		return "document"
	}
	return string(out)
}
