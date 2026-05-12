package vendors

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

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, offset := paginate.Parse(r)

	f := ListFilter{
		Q:           q.Get("q"),
		CountryName: q.Get("countryName"),
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

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	v, err := h.repo.GetByID(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("vendor not found"))
		return
	}
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, v)
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var req CreateVendorRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	if req.Name == "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"name": "required"}))
		return
	}

	userID := deps.CurrentUserID(r.Context())
	v, err := h.repo.Create(r.Context(), req, userID)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, v)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}

	var req UpdateVendorRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	if req.Name == "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"name": "required"}))
		return
	}

	userID := deps.CurrentUserID(r.Context())
	v, err := h.repo.Update(r.Context(), id, req, userID)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("vendor not found"))
		return
	}
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, v)
}

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

func (h *Handler) ListItems(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	limit := paginate.ParseLimit(r, 50)

	items, err := h.repo.ListItems(r.Context(), id, limit)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, items)
}

// PresignLogoUpload handles GET /vendors/{id}/logo/upload-url?fileName=...
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
			httperr.Render(w, httperr.NotFound("vendor not found"))
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
	objectKey := storage.BuildObjectKey("vendors", id, fileName)
	url, err := h.storage.PresignPut(r.Context(), storage.BucketVendorLogos, objectKey, logoUploadExpiry)
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

// PresignLogoDownload handles GET /vendors/{id}/logo/download-url
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
	v, err := h.repo.GetByID(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("vendor not found"))
		return
	}
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	if v.LogoObjectKey == nil || *v.LogoObjectKey == "" {
		httperr.Render(w, httperr.NotFound("no logo attached"))
		return
	}
	url, err := h.storage.PresignGet(r.Context(), storage.BucketVendorLogos, *v.LogoObjectKey, logoDownloadExpiry)
	if err != nil {
		httperr.Render(w, httperr.Internal("presign failed"))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"downloadUrl": url,
		"expiresAt":   time.Now().UTC().Add(logoDownloadExpiry).Unix(),
	})
}

// UpdateLogo handles PATCH /vendors/{id}/logo with body {objectKey}.
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
			httperr.Render(w, httperr.NotFound("vendor not found"))
			return
		}
		httperr.RenderDBErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
