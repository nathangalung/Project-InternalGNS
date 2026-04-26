package clients

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
)

type Handler struct {
	repo *Repo
}

func NewHandler(repo *Repo) *Handler {
	return &Handler{repo: repo}
}

// List handles GET /clients?limit=&offset=
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	limit, offset := parsePagination(r)

	clients, err := h.repo.List(r.Context(), limit, offset)
	if err != nil {
		httperr.Render(w, httperr.Internal(err.Error()))
		return
	}
	writeJSON(w, http.StatusOK, clients)
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
		httperr.Render(w, httperr.Internal(err.Error()))
		return
	}
	writeJSON(w, http.StatusOK, c)
}

// Create handles POST /clients
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var req CreateClientRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	if req.Name == "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"name": "required"}))
		return
	}

	userID := deps.CurrentUserID(r.Context())
	c, err := h.repo.Create(r.Context(), req, userID)
	if err != nil {
		httperr.Render(w, httperr.Internal(err.Error()))
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

// Search handles GET /clients/search?q=&minScore=&limit=
func (h *Handler) Search(w http.ResponseWriter, r *http.Request) {
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

	limit := 10
	if s := r.URL.Query().Get("limit"); s != "" {
		if v, err := strconv.Atoi(s); err == nil && v > 0 {
			limit = v
		}
	}

	results, err := h.repo.Search(r.Context(), q, minScore, limit)
	if err != nil {
		httperr.Render(w, httperr.Internal(err.Error()))
		return
	}
	writeJSON(w, http.StatusOK, results)
}

// ─── Contacts ─────────────────────────────────────────────────

// ListContacts handles GET /clients/{id}/contacts
func (h *Handler) ListContacts(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}

	contacts, err := h.repo.ListContacts(r.Context(), id)
	if err != nil {
		httperr.Render(w, httperr.Internal(err.Error()))
		return
	}
	writeJSON(w, http.StatusOK, contacts)
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
	if req.Name == "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"name": "required"}))
		return
	}

	userID := deps.CurrentUserID(r.Context())
	c, err := h.repo.CreateContact(r.Context(), id, req, userID)
	if err != nil {
		// CHECK constraint violation untuk phone format
		httperr.Render(w, httperr.BadRequest(err.Error()))
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

// ─── Helpers ──────────────────────────────────────────────────

func parsePagination(r *http.Request) (limit, offset int) {
	limit, offset = 50, 0
	if s := r.URL.Query().Get("limit"); s != "" {
		if v, err := strconv.Atoi(s); err == nil && v > 0 && v <= 200 {
			limit = v
		}
	}
	if s := r.URL.Query().Get("offset"); s != "" {
		if v, err := strconv.Atoi(s); err == nil && v >= 0 {
			offset = v
		}
	}
	return
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
