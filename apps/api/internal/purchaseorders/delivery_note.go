package purchaseorders

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/pdfgen"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/tz"
)

// DeliveryNoteHandler renders delivery note PDFs.
// The note mirrors its PO.
type DeliveryNoteHandler struct {
	repo       *Repo
	clients    *clients.Repo
	quotations *quotations.Repo
	renderer   *pdfgen.Renderer
}

func NewDeliveryNoteHandler(
	repo *Repo,
	c *clients.Repo,
	q *quotations.Repo,
	r *pdfgen.Renderer,
) *DeliveryNoteHandler {
	return &DeliveryNoteHandler{repo: repo, clients: c, quotations: q, renderer: r}
}

type dnItem struct {
	No              int
	Qty             string
	Unit            string
	Name            string
	ShipDestination string
}

type dnData struct {
	DeliveryNoteNo string
	PONo           string
	PODate         string
	CompanyName    string
	CompanyAddress string
	AttnName       string
	VesselName     string
	DateLine       string
	Items          []dnItem
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
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}

	dnNo, ok := issuedDeliveryNote(po)
	if !ok {
		httperr.Render(w, httperr.Conflict(
			"Surat jalan baru terbit setelah pekerjaan PO dimulai (ON_PROGRESS)."))
		return
	}

	items, err := h.repo.ListItems(r.Context(), id)
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}

	data, err := h.buildData(r.Context(), po, dnNo, items)
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}

	pdf, err := h.renderer.Render(r.Context(), "delivery_note/DeliveryNote.tex.tmpl", data)
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}

	if werr := pdfgen.WritePDFResponse(w, dnNo, pdf); werr != nil {
		slog.WarnContext(r.Context(), "pdf write failed", "doc", "delivery_note", "po_id", id, "err", werr)
	}
}

// issuedDeliveryNote returns the stored number.
// It does so only once work has started.
// A PO reverted below ON_PROGRESS keeps its number but cannot print it.
func issuedDeliveryNote(po PurchaseOrder) (string, bool) {
	if po.Status != StatusOnProgress && po.Status != StatusDelivered {
		return "", false
	}
	if po.DeliveryNoteNumber == nil || *po.DeliveryNoteNumber == "" {
		return "", false
	}
	return *po.DeliveryNoteNumber, true
}

// buildData maps the note.
// A failed client or quotation read is an error, never a note with a blank
// address, Attn or vessel; only a missing row prints blank.
func (h *DeliveryNoteHandler) buildData(ctx context.Context, po PurchaseOrder, dnNo string, items []PurchaseOrderItem) (dnData, error) {
	client, err := h.clients.GetByID(ctx, po.CompanyClientID)
	if err != nil && !errors.Is(err, clients.ErrNotFound) {
		return dnData{}, fmt.Errorf("delivery note client: %w", err)
	}

	attn, vessel := "", ""
	q, err := h.quotations.GetDetail(ctx, po.QuotationID)
	switch {
	case errors.Is(err, quotations.ErrNotFound):
	case err != nil:
		return dnData{}, fmt.Errorf("delivery note quotation: %w", err)
	default:
		attn, vessel = pdfgen.StrDeref(q.ContactName), pdfgen.StrDeref(q.VesselName)
	}

	return dnData{
		DeliveryNoteNo: pdfgen.LatexEscape(dnNo),
		PONo:           pdfgen.LatexEscape(pdfgen.StrDeref(po.PoNumber)),
		PODate:         po.PoDate.In(tz.Jakarta()).Format("2 January 2006"),
		CompanyName:    pdfgen.LatexBreakable(po.CompanyName),
		CompanyAddress: pdfgen.LatexBreakable(pdfgen.StrDeref(client.Address)),
		AttnName:       pdfgen.LatexEscape(attn),
		VesselName:     pdfgen.LatexEscape(vessel),
		DateLine:       pdfgen.JakartaDateLine(deliveryNoteDate(po).In(tz.Jakarta())),
		Items:          deliveryNoteItems(items),
	}, nil
}

// deliveryNoteDate dates the note.
// The note is dated the day its number was issued, the month that number
// carries. A legacy PO with no stamp falls back to its PO date.
func deliveryNoteDate(po PurchaseOrder) time.Time {
	if po.DeliveryNoteDate != nil {
		return *po.DeliveryNoteDate
	}
	return po.PoDate
}

// deliveryNoteItems lists the delivered lines.
// The shipping charge is billed, not delivered, so it is left out. Its
// address is where the goods go, so a line without its own prints it; the
// stored lines are not touched.
func deliveryNoteItems(items []PurchaseOrderItem) []dnItem {
	fallback := ""
	for _, it := range items {
		if it.ItemType == "shipping" && filled(it.ShipDestination) {
			fallback = *it.ShipDestination
		}
	}
	out := make([]dnItem, 0, len(items))
	for _, it := range items {
		if it.ItemType == "shipping" {
			continue
		}
		unit := ""
		if it.UnitCode != nil {
			unit = *it.UnitCode
		}
		ship := fallback
		if filled(it.ShipDestination) {
			ship = *it.ShipDestination
		}
		out = append(out, dnItem{
			No:              len(out) + 1,
			Qty:             pdfgen.FormatQty(it.Qty),
			Unit:            pdfgen.LatexEscape(unit),
			Name:            pdfgen.LatexBreakable(it.ItemName),
			ShipDestination: pdfgen.LatexBreakable(ship),
		})
	}
	return out
}
