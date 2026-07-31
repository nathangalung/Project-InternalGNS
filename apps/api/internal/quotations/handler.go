package quotations

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
	"github.com/nathangalung/internalgns/apps/api/internal/shared/paginate"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/sheet"
)

type Handler struct {
	repo *Repo
}

func NewHandler(repo *Repo) *Handler {
	return &Handler{repo: repo}
}

// parseListFilter reads the shared list filters (no pagination).
func parseListFilter(r *http.Request) ListFilter {
	q := r.URL.Query()
	f := ListFilter{
		Q:       q.Get("q"),
		SortBy:  q.Get("sortBy"),
		SortDir: q.Get("sortDir"),
	}
	if s := q.Get("status"); s != "" {
		f.Statuses = strings.Split(s, ",")
	}
	if s := q.Get("dateFrom"); s != "" {
		f.DateFrom = &s
	}
	if s := q.Get("dateTo"); s != "" {
		f.DateTo = &s
	}
	if s := q.Get("minTotal"); s != "" {
		f.MinTotal = &s
	}
	if s := q.Get("maxTotal"); s != "" {
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

// exportMaxRows caps a filtered export to the full result set.
const exportMaxRows = 100000

// Export streams the filtered quotation list as an XLSX table.
func (h *Handler) Export(w http.ResponseWriter, r *http.Request) {
	f := parseListFilter(r)
	f.Limit, f.Offset = exportMaxRows, 0

	res, err := h.repo.List(r.Context(), f)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	headers := []string{"No. Quotation", "Tanggal", "Klien", "Status", "Subtotal", "Diskon", "Grand Total"}
	rows := make([][]string, 0, len(res.Rows))
	for _, q := range res.Rows {
		rows = append(rows, []string{
			q.QuotationNo,
			q.CreatedAt.In(time.Local).Format("2006-01-02"),
			q.CompanyName,
			q.Status,
			q.Subtotal,
			q.TotalDiscount,
			q.GrandTotal,
		})
	}
	data, err := sheet.Write("Quotation", headers, rows)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteXLSX(w, "quotation-export", data)
}

func (h *Handler) Stats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.repo.Stats(r.Context())
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, stats)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
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
	httpx.WriteJSON(w, http.StatusOK, d)
}

func (h *Handler) Revisions(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}

	revs, err := h.repo.ListRevisions(r.Context(), id)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, revs)
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var req CreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	// DB function does rest.
	if req.CompanyClientID == 0 {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"companyClientId": "required"}))
		return
	}
	if len(req.Items) == 0 {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"items": "at least 1 required"}))
		return
	}

	userID := deps.CurrentUserID(r.Context())
	id, err := h.repo.Create(r.Context(), req, userID)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]int64{"id": id})
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
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

	var req UpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	if len(req.Items) == 0 {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"items": "at least 1 required"}))
		return
	}

	userID := deps.CurrentUserID(r.Context())
	newVersion, err := h.repo.Update(r.Context(), id, req, userID, ifMatch)
	if err != nil {
		// 409 per round3_plan optimistic-lock contract (not RFC 7232 412).
		if errors.Is(err, ErrVersionMismatch) {
			httperr.Render(w, httperr.Conflict("quotation row_version mismatch"))
			return
		}
		if errors.Is(err, ErrNotFound) {
			httperr.Render(w, httperr.NotFound("quotation not found"))
			return
		}
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"id":         id,
		"rowVersion": newVersion,
	})
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
	if req.Status == "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"status": "required"}))
		return
	}

	userID := deps.CurrentUserID(r.Context())
	if err := h.repo.ChangeStatus(r.Context(), id, req.Status, req.Note, userID); err != nil {
		renderStatusErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// renderStatusErr maps the unpriced-products guard to 422, else a DB error.
func renderStatusErr(w http.ResponseWriter, err error) {
	if errors.Is(err, ErrUnpricedProducts) {
		httperr.Render(w, httperr.Unprocessable(map[string]string{
			"items": "all product lines must have a selling price before sending",
		}))
		return
	}
	httperr.RenderDBErr(w, err)
}

func (h *Handler) ChangeContact(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}

	var req ChangeContactRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	if req.ContactID == 0 {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"contactId": "required"}))
		return
	}

	userID := deps.CurrentUserID(r.Context())
	if err := h.repo.UpdateContact(r.Context(), id, req.ContactID, userID); err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Render(w, httperr.NotFound("quotation not found"))
			return
		}
		if errors.Is(err, ErrContactNotAllowed) {
			httperr.Render(w, httperr.Unprocessable(map[string]string{
				"contactId": "contact not found or does not belong to this client",
			}))
			return
		}
		httperr.RenderDBErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Send forces status to sent with optional note.
func (h *Handler) Send(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	note := "Quotation dikirim ke klien"
	if r.Body != nil {
		var body struct {
			Note *string `json:"note,omitempty"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body.Note != nil && strings.TrimSpace(*body.Note) != "" {
			note = *body.Note
		}
	}
	userID := deps.CurrentUserID(r.Context())
	if err := h.repo.ChangeStatus(r.Context(), id, "sent", &note, userID); err != nil {
		renderStatusErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
