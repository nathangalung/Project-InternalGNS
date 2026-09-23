package purchaseorders

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/pdfgen"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/tz"
)

// DeliveryNoteHandler renders the delivery note PDF mirror of a PO.
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
		httperr.RenderDBErr(w, err)
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
		httperr.RenderDBErr(w, err)
		return
	}

	data := h.buildData(r.Context(), po, dnNo, items)

	pdf, err := h.renderer.Render(r.Context(), "delivery_note/DeliveryNote.tex.tmpl", data)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}

	if werr := pdfgen.WritePDFResponse(w, dnNo, pdf); werr != nil {
		slog.WarnContext(r.Context(), "pdf write failed", "doc", "delivery_note", "po_id", id, "err", werr)
	}
}

// issuedDeliveryNote returns the stored number once work has started.
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

func (h *DeliveryNoteHandler) buildData(ctx context.Context, po PurchaseOrder, dnNo string, items []PurchaseOrderItem) dnData {
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
		DeliveryNoteNo: pdfgen.LatexEscape(dnNo),
		PONo:           pdfgen.LatexEscape(po.PoNumber),
		CompanyName:    pdfgen.LatexEscape(po.CompanyName),
		CompanyAddress: pdfgen.LatexEscape(pdfgen.StrDeref(client.Address)),
		AttnName:       pdfgen.LatexEscape(attn),
		VesselName:     pdfgen.LatexEscape(vessel),
		DateLine:       pdfgen.JakartaDateLine(po.PoDate.In(tz.Jakarta())),
		Items:          expItems,
	}
}
