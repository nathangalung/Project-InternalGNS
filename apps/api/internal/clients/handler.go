package clients

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httpx"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/paginate"
)

type Handler struct {
	repo *Repo
}

func NewHandler(repo *Repo) *Handler {
	return &Handler{repo: repo}
}

// List handles GET /clients.
// It applies filters, sort and pagination.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if key := badQueryParam(q); key != "" {
		httperr.Render(w, httperr.BadRequest("invalid text in query parameter "+key))
		return
	}
	limit, offset := paginate.Parse(r)

	f := ListFilter{
		Q:           q.Get("q"),
		CountryCode: q.Get("countryCode"),
		SortBy:      q.Get("sortBy"),
		SortDir:     q.Get("sortDir"),
		Limit:       limit,
		Offset:      offset,
	}
	if s := q.Get("isActive"); s != "" {
		switch s {
		case "true", "1":
			v := true
			f.IsActive = &v
		case "false", "0":
			v := false
			f.IsActive = &v
		}
	}
	if s := q.Get("minTotal"); s != "" {
		f.MinTotal = &s
	}

	res, err := h.repo.List(r.Context(), f)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	w.Header().Set("X-Total-Count", strconv.FormatInt(res.Total, 10))
	httpx.WriteJSON(w, http.StatusOK, res.Rows)
}

// Get handles GET /clients/{id}
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}

	c, err := h.repo.GetByID(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("client not found"))
		return
	}
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, c)
}

// Create handles POST /clients
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var req CreateClientRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"name": "required"}))
		return
	}
	number, ok := normalizeNumber(req.Number)
	if !ok {
		numberProblem(w, ErrNumberInvalid)
		return
	}
	req.Number = number

	userID := deps.CurrentUserID(r.Context())
	c, err := h.repo.Create(r.Context(), req, userID)
	if numberProblem(w, err) {
		return
	}
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, c)
}

// Update handles PUT /clients/{id}
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}

	var req UpdateClientRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"name": "required"}))
		return
	}

	number, ok := normalizeNumber(req.Number)
	if !ok {
		numberProblem(w, ErrNumberInvalid)
		return
	}
	req.Number = number

	userID := deps.CurrentUserID(r.Context())
	c, err := h.repo.Update(r.Context(), id, req, userID)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("client not found"))
		return
	}
	if numberProblem(w, err) {
		return
	}
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, c)
}

// Summary handles GET /clients/summary
func (h *Handler) Summary(w http.ResponseWriter, r *http.Request) {
	s, err := h.repo.Summary(r.Context())
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, s)
}

// Search handles GET /clients/search?q=&minScore=&limit=
func (h *Handler) Search(w http.ResponseWriter, r *http.Request) {
	if key := badQueryParam(r.URL.Query()); key != "" {
		httperr.Render(w, httperr.BadRequest("invalid text in query parameter "+key))
		return
	}
	q := r.URL.Query().Get("q")
	if q == "" {
		httperr.Render(w, httperr.BadRequest("q is required"))
		return
	}

	minScore := float32(0.3)
	if s := r.URL.Query().Get("minScore"); s != "" {
		if v, err := strconv.ParseFloat(s, 32); err == nil {
			minScore = float32(v)
		}
	}

	limit := paginate.ParseLimit(r, 10)

	results, err := h.repo.Search(r.Context(), q, minScore, limit)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, results)
}

// ListContacts handles GET /clients/{id}/contacts
func (h *Handler) ListContacts(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}

	if err := h.requireClient(r.Context(), id); err != nil {
		renderClientErr(w, err)
		return
	}
	contacts, err := h.repo.ListContacts(r.Context(), id)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, contacts)
}

// CreateContact handles POST /clients/{id}/contacts
func (h *Handler) CreateContact(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}

	var req CreateContactRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"name": "required"}))
		return
	}

	userID := deps.CurrentUserID(r.Context())
	c, err := h.repo.CreateContact(r.Context(), id, req, userID)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, c)
}

// UpdateContact edits a contact.
// It serves PATCH /clients/{id}/contacts/{cid}.
func (h *Handler) UpdateContact(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	cid, err := strconv.ParseInt(chi.URLParam(r, "contactId"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid contact id"))
		return
	}

	var req UpdateContactRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"name": "required"}))
		return
	}

	userID := deps.CurrentUserID(r.Context())
	c, err := h.repo.UpdateContact(r.Context(), id, cid, req, userID)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("contact not found"))
		return
	}
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, c)
}

// DeleteContact soft-deletes a contact.
func (h *Handler) DeleteContact(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	cid, err := strconv.ParseInt(chi.URLParam(r, "contactId"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid contact id"))
		return
	}
	if err := h.repo.DeactivateContact(r.Context(), id, cid, deps.CurrentUserID(r.Context())); err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Render(w, httperr.NotFound("contact not found"))
			return
		}
		httperr.RenderDBErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// requireClient checks the parent exists.
// It runs before a sub-collection read.
func (h *Handler) requireClient(ctx context.Context, id int64) error {
	_, err := h.repo.GetByID(ctx, id)
	if err != nil {
		return fmt.Errorf("load client %d: %w", id, err)
	}
	return nil
}

// renderClientErr maps sentinels to problems.
func renderClientErr(w http.ResponseWriter, err error) {
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("client not found"))
		return
	}
	httperr.RenderDBErr(w, err)
}
