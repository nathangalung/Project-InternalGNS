package clients

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
	"github.com/nathangalung/internalgns/apps/api/internal/storage"
)

const (
	logoUploadExpiry   = 15 * time.Minute
	logoDownloadExpiry = 1 * time.Hour
)

type Handler struct {
	repo    *Repo
	storage *storage.Client
}

func NewHandler(repo *Repo) *Handler {
	return &Handler{repo: repo}
}

// List handles GET /clients with filters, sort, pagination.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
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
	if req.Name == "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"name": "required"}))
		return
	}

	userID := deps.CurrentUserID(r.Context())
	c, err := h.repo.Create(r.Context(), req, userID)
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
	if req.Name == "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"name": "required"}))
		return
	}

	userID := deps.CurrentUserID(r.Context())
	c, err := h.repo.Update(r.Context(), id, req, userID)
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

// UpdateContact edits an existing contact (PATCH /clients/{id}/contacts/{cid}).
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

// PresignLogoUpload handles GET /clients/{id}/logo/upload-url?fileName=...
func (h *Handler) PresignLogoUpload(w http.ResponseWriter, r *http.Request) {
	if h.storage == nil {
		httperr.Render(w, httperr.ServiceUnavailable("storage not configured"))
		return
	}
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	if _, err := h.repo.GetByID(r.Context(), id); err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Render(w, httperr.NotFound("client not found"))
			return
		}
		httperr.RenderDBErr(w, err)
		return
	}
	fileName := strings.TrimSpace(r.URL.Query().Get("fileName"))
	if fileName == "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"fileName": "required"}))
		return
	}
	if err := storage.ValidateAssetFileName(storage.BucketClientLogos, fileName); err != nil {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"fileName": "unsupported file type"}))
		return
	}
	objectKey := storage.BuildObjectKey("clients", id, fileName)
	url, err := h.storage.PresignPut(r.Context(), storage.BucketClientLogos, objectKey, logoUploadExpiry)
	if err != nil {
		httperr.Render(w, httperr.Internal("presign failed"))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"uploadUrl": url,
		"objectKey": objectKey,
		"expiresAt": time.Now().UTC().Add(logoUploadExpiry).Unix(),
	})
}

// PresignLogoDownload handles GET /clients/{id}/logo/download-url
func (h *Handler) PresignLogoDownload(w http.ResponseWriter, r *http.Request) {
	if h.storage == nil {
		httperr.Render(w, httperr.ServiceUnavailable("storage not configured"))
		return
	}
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
	if c.LogoObjectKey == nil || *c.LogoObjectKey == "" {
		httperr.Render(w, httperr.NotFound("no logo attached"))
		return
	}
	url, err := h.storage.PresignGet(r.Context(), storage.BucketClientLogos, *c.LogoObjectKey, logoDownloadExpiry)
	if err != nil {
		httperr.Render(w, httperr.Internal("presign failed"))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"downloadUrl": url,
		"expiresAt":   time.Now().UTC().Add(logoDownloadExpiry).Unix(),
	})
}

// UpdateLogo handles PATCH /clients/{id}/logo with body {objectKey}.
func (h *Handler) UpdateLogo(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	var req UpdateLogoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	if strings.TrimSpace(req.ObjectKey) == "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"objectKey": "required"}))
		return
	}
	actor := deps.CurrentUserID(r.Context())
	if err := h.repo.UpdateLogo(r.Context(), id, req.ObjectKey, actor); err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Render(w, httperr.NotFound("client not found"))
			return
		}
		httperr.RenderDBErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
