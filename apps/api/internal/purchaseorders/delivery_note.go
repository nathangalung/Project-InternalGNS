package purchaseorders

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
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
)

// DeliveryNoteHandler renders the SURAT JALAN PDF mirror of a PO.
type DeliveryNoteHandler struct {
	repo       *Repo
	clients    *clients.Repo
	quotations *quotations.Repo
	renderer   *pdfgen.Renderer
	settings   deps.PdfSettings
}

func NewDeliveryNoteHandler(
	repo *Repo,
	c *clients.Repo,
	q *quotations.Repo,
	r *pdfgen.Renderer,
	s deps.PdfSettings,
) *DeliveryNoteHandler {
	return &DeliveryNoteHandler{repo: repo, clients: c, quotations: q, renderer: r, settings: s}
}

type dnItem struct {
	No              int
	Qty             string
	Unit            string
	Name            string
	ShipDestination string
}

type dnData struct {
	DeliveryNoteNo  string
	PONo            string
	CompanyName     string
	CompanyAddress  string
	AttnName        string
	VesselName      string
	DateLine        string
	Items           []dnItem
	PreparedBy      string
	SenderName      string
}

func (h *DeliveryNoteHandler) ExportPDF(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}

	po, err := h.repo.GetByID(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("purchase order not found"))
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

	data := h.buildData(r.Context(), po, items)

	pdf, err := h.renderer.Render(r.Context(), "delivery_note/DeliveryNote.tex.tmpl", data)
	if err != nil {
		httperr.Render(w, httperr.Internal(err.Error()))
		return
	}

	dn := "DN-" + po.PoNumber
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`inline; filename="%s.pdf"`, sanitizeFilename(dn)))
	_, _ = w.Write(pdf)
}

func (h *DeliveryNoteHandler) buildData(ctx context.Context, po PurchaseOrder, items []PurchaseOrderItem) dnData {
	client, _ := h.clients.GetByID(ctx, po.CompanyClientID)

	attn, vessel := "", ""
	if q, err := h.quotations.GetDetail(ctx, po.QuotationID); err == nil {
		if q.ContactName != nil {
			attn = *q.ContactName
		}
		if q.VesselName != nil {
			vessel = *q.VesselName
		}
	}

	expItems := make([]dnItem, 0, len(items))
	for i, it := range items {
		unit := ""
		if it.UnitCode != nil {
			unit = *it.UnitCode
		}
		ship := ""
		if it.ShipDestination != nil {
			ship = *it.ShipDestination
		}
		expItems = append(expItems, dnItem{
			No:              i + 1,
			Qty:             pdfgen.FormatQty(it.Qty),
			Unit:            pdfgen.LatexEscape(unit),
			Name:            pdfgen.LatexEscape(it.ItemName),
			ShipDestination: pdfgen.LatexEscape(ship),
		})
	}

	return dnData{
		DeliveryNoteNo:  pdfgen.LatexEscape("DN-" + po.PoNumber),
		PONo:            pdfgen.LatexEscape(po.PoNumber),
		CompanyName:     pdfgen.LatexEscape(po.CompanyName),
		CompanyAddress:  pdfgen.LatexEscape(strDeref(client.Address)),
		AttnName:        pdfgen.LatexEscape(attn),
		VesselName:      pdfgen.LatexEscape(vessel),
		DateLine:        pdfgen.JakartaDateLine(po.PoDate.In(time.Local)),
		Items:           expItems,
		PreparedBy:      pdfgen.LatexEscape(h.settings.SignerName),
		SenderName:      pdfgen.LatexEscape(h.settings.SignerName),
	}
}

func strDeref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
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
