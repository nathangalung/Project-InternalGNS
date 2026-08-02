package purchaseorders

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httpx"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/listq"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/paginate"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/sheet"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/tz"
)

type Handler struct {
	repo *Repo
}

func NewHandler(repo *Repo) *Handler {
	return &Handler{repo: repo}
}

// parseListFilter reads the shared PO list filters (no pagination).
func parseListFilter(r *http.Request) ListFilter {
	q := r.URL.Query()
	f := ListFilter{
		Q:       strings.TrimSpace(q.Get("q")),
		SortBy:  q.Get("sortBy"),
		SortDir: q.Get("sortDir"),
	}
	if s := strings.TrimSpace(q.Get("status")); s != "" {
		for _, raw := range strings.Split(s, ",") {
			if v := strings.TrimSpace(raw); v != "" {
				f.Statuses = append(f.Statuses, v)
			}
		}
	}
	f.DateFrom = httpx.ParseDateParam(q.Get("dateFrom"))
	f.DateTo = httpx.ParseDateParam(q.Get("dateTo"))
	if s := strings.TrimSpace(q.Get("minTotal")); s != "" {
		f.MinTotal = &s
	}
	if s := strings.TrimSpace(q.Get("maxTotal")); s != "" {
		f.MaxTotal = &s
	}
	return f
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	f := parseListFilter(r)
	f.Limit, f.Offset = paginate.Parse(r)

	res, err := h.repo.List(r.Context(), f)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	w.Header().Set("X-Total-Count", strconv.FormatInt(res.Total, 10))
	httpx.WriteJSON(w, http.StatusOK, res.Rows)
}

// Export streams the filtered PO list (with delivery-note numbers) as XLSX.
func (h *Handler) Export(w http.ResponseWriter, r *http.Request) {
	f := parseListFilter(r)
	f.Limit, f.Offset = listq.Unbounded, 0

	res, err := h.repo.List(r.Context(), f)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WarnIfTruncated(r.Context(), "purchaseorders.export", res.Total, len(res.Rows))
	headers := []string{"No. Delivery Note", "No. PO", "No. Quotation", "Tanggal", "Klien", "Status", "Total"}
	rows := make([][]string, 0, len(res.Rows))
	for _, po := range res.Rows {
		rows = append(rows, []string{
			deliveryNoteNumber(po.QuotationNo, po.PoNumber),
			po.PoNumber,
			po.QuotationNo,
			po.PoDate.In(tz.Jakarta()).Format("2006-01-02"),
			po.CompanyName,
			string(po.Status),
			po.PoTotalProduk,
		})
	}
	data, err := sheet.Write("Delivery Note", headers, rows)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteXLSX(w, "delivery-note-export", data)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
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
	httpx.WriteJSON(w, http.StatusOK, po)
}

func (h *Handler) GetByQuotation(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "quotationId"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid quotation id"))
		return
	}
	po, err := h.repo.GetByQuotation(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("purchase order not found"))
		return
	}
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, po)
}

func (h *Handler) ListItems(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	items, err := h.repo.ListItems(r.Context(), id)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, items)
}

func (h *Handler) UpdateFile(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	var req UpdateFileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	if strings.TrimSpace(req.FileName) == "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"fileName": "required"}))
		return
	}
	if strings.TrimSpace(req.ObjectKey) == "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"objectKey": "required"}))
		return
	}

	actor := deps.CurrentUserID(r.Context())
	if err := h.repo.UpdateFile(r.Context(), id, req, actor); err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Render(w, httperr.NotFound("purchase order not found"))
			return
		}
		httperr.RenderDBErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) UpdateNotes(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	var req UpdateNotesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	actor := deps.CurrentUserID(r.Context())
	if err := h.repo.UpdateNotes(r.Context(), id, req.Notes, actor); err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Render(w, httperr.NotFound("purchase order not found"))
			return
		}
		httperr.RenderDBErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) UpdateDetails(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	var req UpdateDetailsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	if strings.TrimSpace(req.PoNumber) == "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"poNumber": "required"}))
		return
	}
	poDate, err := time.Parse("2006-01-02", strings.TrimSpace(req.PoDate))
	if err != nil {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"poDate": "must be YYYY-MM-DD"}))
		return
	}
	actor := deps.CurrentUserID(r.Context())
	if err := h.repo.UpdateDetails(r.Context(), id, strings.TrimSpace(req.PoNumber), poDate, actor); err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			httperr.Render(w, httperr.NotFound("purchase order not found"))
		case errors.Is(err, ErrDuplicatePoNumber):
			httperr.Render(w, httperr.Unprocessable(map[string]string{"poNumber": "already used by another PO"}))
		default:
			httperr.RenderDBErr(w, err)
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) ChangeStatus(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	var req ChangeStatusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	if !isValidStatus(req.Status) {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"status": "invalid status"}))
		return
	}
	actor := deps.CurrentUserID(r.Context())
	if err := h.repo.ChangeStatus(r.Context(), id, req.Status, actor); err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			httperr.Render(w, httperr.NotFound("purchase order not found"))
		case errors.Is(err, ErrInvalidTransition):
			httperr.Render(w, httperr.Unprocessable(map[string]string{"status": err.Error()}))
		// 409, unlike the 422 UpdateItems returns for the same sentinel: here
		// the PO itself is valid and a dependent invoice blocks the change.
		case errors.Is(err, ErrLocked):
			httperr.Render(w, httperr.Conflict(err.Error()))
		default:
			httperr.RenderDBErr(w, err)
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) UpdateItems(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	ifMatch, err := httpx.ParseIfMatch(r.Header.Get("If-Match"))
	if err != nil {
		httperr.Render(w, httperr.BadRequest(err.Error()))
		return
	}
	if ifMatch == nil {
		httperr.Render(w, httperr.BadRequest("If-Match header required"))
		return
	}
	var req UpdateItemsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	if strings.TrimSpace(req.DiscountPct) == "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"discountPct": "required"}))
		return
	}
	actor := deps.CurrentUserID(r.Context())
	newVersion, err := h.repo.UpdateItems(r.Context(), id, req, actor, ifMatch)
	if err != nil {
		switch {
		// 409 per round3_plan optimistic-lock contract (not RFC 7232 412).
		case errors.Is(err, ErrVersionMismatch):
			httperr.Render(w, httperr.Conflict("purchase order row_version mismatch"))
		case errors.Is(err, ErrNotFound):
			httperr.Render(w, httperr.NotFound("purchase order not found"))
		case errors.Is(err, ErrLocked):
			httperr.Render(w, httperr.Unprocessable(map[string]string{"status": "PO locked in DELIVERED state"}))
		default:
			httperr.RenderDBErr(w, err)
		}
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"id":         id,
		"rowVersion": newVersion,
	})
}

func isValidStatus(s Status) bool {
	switch s {
	case StatusPending, StatusUploaded, StatusOnProgress, StatusDelivered:
		return true
	}
	return false
}
