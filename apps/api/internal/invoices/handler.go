package invoices

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

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

// parseListFilter reads the shared invoice list filters (no pagination).
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
	if s := strings.TrimSpace(q.Get("effectiveStatus")); s != "" {
		for _, raw := range strings.Split(s, ",") {
			if v := strings.TrimSpace(raw); v != "" {
				f.EffectiveStatuses = append(f.EffectiveStatuses, v)
			}
		}
	}
	f.DateFrom = httpx.ParseDateParam(q.Get("dateFrom"))
	f.DateTo = httpx.ParseDateParam(q.Get("dateTo"))
	f.DueFrom = httpx.ParseDateParam(q.Get("dueFrom"))
	f.DueTo = httpx.ParseDateParam(q.Get("dueTo"))
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

// Export streams the filtered invoice list as an XLSX table.
func (h *Handler) Export(w http.ResponseWriter, r *http.Request) {
	f := parseListFilter(r)
	f.Limit, f.Offset = listq.Unbounded, 0

	res, err := h.repo.List(r.Context(), f)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WarnIfTruncated(r.Context(), "invoices.export", res.Total, len(res.Rows))
	headers := []string{"No. Invoice", "No. Quotation", "Tanggal", "Jatuh Tempo", "Klien", "Status", "Total"}
	rows := make([][]string, 0, len(res.Rows))
	for _, inv := range res.Rows {
		due := ""
		if inv.DueDate != nil {
			due = inv.DueDate.In(tz.Jakarta()).Format("2006-01-02")
		}
		total := ""
		if inv.Total != nil {
			total = *inv.Total
		}
		rows = append(rows, []string{
			inv.InvoiceNo,
			inv.QuotationNo,
			inv.InvoiceDate.In(tz.Jakarta()).Format("2006-01-02"),
			due,
			inv.CompanyName,
			string(inv.Status),
			total,
		})
	}
	data, err := sheet.Write("Invoice", headers, rows)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteXLSX(w, "invoice-export", data)
}

func (h *Handler) Summary(w http.ResponseWriter, r *http.Request) {
	s, err := h.repo.Summary(r.Context())
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, s)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
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
	httpx.WriteJSON(w, http.StatusOK, inv)
}

func (h *Handler) GetByQuotation(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "quotationId"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid quotation id"))
		return
	}
	inv, err := h.repo.GetByQuotation(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("invoice not found"))
		return
	}
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, inv)
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
		if errors.Is(err, ErrNotFound) {
			httperr.Render(w, httperr.NotFound("invoice not found"))
			return
		}
		httperr.RenderDBErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) UpdateDates(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	var req UpdateDatesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	ifMatch, err := httpx.ParseIfMatch(r.Header.Get("If-Match"))
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid If-Match header"))
		return
	}
	if ifMatch == nil {
		httperr.Render(w, httperr.BadRequest("If-Match header required"))
		return
	}
	actor := deps.CurrentUserID(r.Context())
	newVersion, err := h.repo.UpdateDates(r.Context(), id, req, actor, ifMatch)
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			httperr.Render(w, httperr.NotFound("invoice not found"))
		case errors.Is(err, ErrVersionMismatch):
			// Use 409 per round3_plan optimistic-lock contract (not RFC 7232 412).
			httperr.Render(w, httperr.Conflict("invoice row_version mismatch"))
		default:
			httperr.RenderDBErr(w, err)
		}
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]int32{"rowVersion": newVersion})
}

func isValidStatus(s Status) bool {
	switch s {
	case StatusDraft, StatusSent, StatusPaid, StatusOverdue, StatusCancelled:
		return true
	}
	return false
}
