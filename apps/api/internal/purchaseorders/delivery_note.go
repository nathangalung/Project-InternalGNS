package purchaseorders

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/pdfgen"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/tz"
)

// DeliveryNoteHandler renders delivery note PDFs.
// The note mirrors its PO.
type DeliveryNoteHandler struct {
	repo     *Repo
	clients  *clients.Repo
	renderer *pdfgen.Renderer
}

func NewDeliveryNoteHandler(
	repo *Repo,
	c *clients.Repo,
	r *pdfgen.Renderer,
) *DeliveryNoteHandler {
	return &DeliveryNoteHandler{repo: repo, clients: c, renderer: r}
}

type dnItem struct {
	No   int
	Qty  string
	Unit string
	Name string
	Note string
}

type dnData struct {
	DeliveryNoteNo string
	PONo           string
	PODate         string
	CompanyName    string
	CompanyAddress string
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
			"Surat jalan tersedia setelah status PO Dalam Progres."))
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
// The Address is where the goods go, which falls back to the client's own
// address. A failed client read is an error, never a note with a blank
// address; only a missing row prints blank.
func (h *DeliveryNoteHandler) buildData(ctx context.Context, po PurchaseOrder, dnNo string, items []PurchaseOrderItem) (dnData, error) {
	client, err := h.clients.GetByID(ctx, po.CompanyClientID)
	if err != nil && !errors.Is(err, clients.ErrNotFound) {
		return dnData{}, fmt.Errorf("delivery note client: %w", err)
	}
	address := deliveryNoteAddress(items, pdfgen.StrDeref(client.Address))

	return dnData{
		DeliveryNoteNo: pdfgen.LatexEscape(dnNo),
		PONo:           pdfgen.LatexEscape(pdfgen.StrDeref(po.PoNumber)),
		PODate:         po.PoDate.In(tz.Jakarta()).Format("2 January 2006"),
		CompanyName:    pdfgen.LatexBreakable(po.CompanyName),
		CompanyAddress: pdfgen.LatexAddress(address, pdfgen.PartyKeep),
		DateLine:       pdfgen.JakartaDateLine(deliveryNoteDate(po).In(tz.Jakarta())),
		Items:          deliveryNoteItems(items, address),
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
// The shipping charge is billed, not delivered, so it is left out. Each
// row prints its saved note, or its default until a note is saved.
func deliveryNoteItems(items []PurchaseOrderItem, address string) []dnItem {
	out := make([]dnItem, 0, len(items))
	for _, it := range items {
		if it.ItemType == "shipping" {
			continue
		}
		unit := ""
		if it.UnitCode != nil {
			unit = *it.UnitCode
		}
		note := defaultNote(it, address)
		if it.DnNote != nil {
			note = *it.DnNote
		}
		out = append(out, dnItem{
			No:   len(out) + 1,
			Qty:  pdfgen.FormatQty(it.Qty),
			Unit: pdfgen.LatexEscape(unit),
			Name: pdfgen.LatexBreakable(it.ItemName),
			Note: pdfgen.LatexAddress(note, pdfgen.CellKeep),
		})
	}
	return out
}

// deliveryNoteAddress picks the Address.
// It is where the goods go: the shipping line's address, else the one place
// every addressed product line names, else the client's own address.
func deliveryNoteAddress(items []PurchaseOrderItem, clientAddress string) string {
	if addr, ok := linesAddress(items); ok {
		return addr
	}
	return clientAddress
}

// linesAddress reads the PO's destination.
// It reports false when the lines name no place, or more than one, so the
// caller falls back to the client.
func linesAddress(items []PurchaseOrderItem) (string, bool) {
	for _, it := range items {
		if it.ItemType == "shipping" && filled(it.ShipDestination) {
			return *it.ShipDestination, true
		}
	}
	shared := ""
	for _, it := range items {
		if it.ItemType != "product" || !filled(it.ShipDestination) {
			continue
		}
		if shared == "" {
			shared = *it.ShipDestination
		} else if !sameAddress(shared, *it.ShipDestination) {
			return "", false
		}
	}
	return shared, shared != ""
}

// defaultNote is a row's starting note.
// A product line whose own destination is not the Address says where it
// goes. Every other row starts blank.
func defaultNote(it PurchaseOrderItem, address string) string {
	if it.ItemType != "product" || !filled(it.ShipDestination) || sameAddress(*it.ShipDestination, address) {
		return ""
	}
	return "Kirim ke: " + pdfgen.NormalizeAddress(*it.ShipDestination)
}

// withNoteDefaults fills each starting note.
func withNoteDefaults(items []PurchaseOrderItem, address string) {
	for i := range items {
		items[i].DnNoteDefault = defaultNote(items[i], address)
	}
}

// sameAddress ignores spacing and case.
func sameAddress(a, b string) bool {
	return strings.EqualFold(pdfgen.NormalizeAddress(a), pdfgen.NormalizeAddress(b))
}
