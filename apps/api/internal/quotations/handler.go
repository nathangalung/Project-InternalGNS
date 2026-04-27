package quotations

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
)

type Handler struct {
	repo *Repo
}

func NewHandler(repo *Repo) *Handler {
	return &Handler{repo: repo}
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
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
	if s := q.Get("limit"); s != "" {
		if v, err := strconv.Atoi(s); err == nil && v > 0 && v <= 200 {
			f.Limit = v
		}
	}
	if s := q.Get("offset"); s != "" {
		if v, err := strconv.Atoi(s); err == nil && v >= 0 {
			f.Offset = v
		}
	}

	rows, err := h.repo.List(r.Context(), f)
	if err != nil {
		httperr.Render(w, httperr.Internal(err.Error()))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, rows)
}

func (h *Handler) Stats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.repo.Stats(r.Context())
	if err != nil {
		httperr.Render(w, httperr.Internal(err.Error()))
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
		httperr.Render(w, httperr.Internal(err.Error()))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, d)
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
		// Validation comes from DB.
		httperr.Render(w, httperr.BadRequest(err.Error()))
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
	_, err = h.repo.Update(r.Context(), id, req, userID)
	if err != nil {
		// Update needs draft status.
		httperr.Render(w, httperr.BadRequest(err.Error()))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]int64{"id": id})
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
		// DB rejects bad transition.
		httperr.Render(w, httperr.BadRequest(err.Error()))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Force status to sent.
func (h *Handler) Send(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}

	userID := deps.CurrentUserID(r.Context())
	if err := h.repo.ChangeStatus(r.Context(), id, "sent", strPtr("Quotation sent to client"), userID); err != nil {
		httperr.Render(w, httperr.BadRequest(err.Error()))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func strPtr(s string) *string { return &s }
