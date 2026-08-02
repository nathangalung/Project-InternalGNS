// Package assetproxy shares the presigned asset routes.
package assetproxy

import (
	"context"
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
	"github.com/nathangalung/internalgns/apps/api/internal/storage"
)

// ErrNotFound signals a missing owner row.
var ErrNotFound = errors.New("assetproxy: not found")

// Asset is the stored key plus extra download fields.
// Extra is merged into the download response; purchase orders use it to
// return the original file name alongside the URL.
type Asset struct {
	Key   string
	Extra map[string]any
}

// Descriptor configures one resource asset route set.
type Descriptor struct {
	Storage     *storage.Client
	Bucket      string
	KeyPrefix   string
	NotFoundMsg string
	NoAssetMsg  string
	UploadTTL   time.Duration
	DownloadTTL time.Duration

	// Exists reports whether the owner row exists, returning ErrNotFound.
	Exists func(ctx context.Context, id int64) error
	// CurrentAsset returns the attached asset, or an empty Key when none.
	CurrentAsset func(ctx context.Context, id int64) (Asset, error)
	// SetKey persists the object key against the owner row.
	SetKey func(ctx context.Context, id int64, key string, actor int64) error
}

// Upload presigns a PUT for a new asset.
func Upload(d Descriptor) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if d.Storage == nil {
			httperr.Render(w, httperr.ServiceUnavailable("storage not configured"))
			return
		}
		id, ok := parseID(w, r)
		if !ok {
			return
		}
		if err := d.Exists(r.Context(), id); err != nil {
			renderOwnerErr(w, err, d.NotFoundMsg)
			return
		}
		fileName := strings.TrimSpace(r.URL.Query().Get("fileName"))
		if fileName == "" {
			httperr.Render(w, httperr.Unprocessable(map[string]string{"fileName": "required"}))
			return
		}
		if err := storage.ValidateAssetFileName(d.Bucket, fileName); err != nil {
			httperr.Render(w, httperr.Unprocessable(map[string]string{"fileName": "unsupported file type"}))
			return
		}
		objectKey := storage.BuildObjectKey(d.KeyPrefix, id, fileName)
		url, err := d.Storage.PresignPut(r.Context(), d.Bucket, objectKey, d.UploadTTL)
		if err != nil {
			httperr.Render(w, httperr.Internal("presign failed"))
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"uploadUrl": url,
			"objectKey": objectKey,
			"expiresAt": time.Now().UTC().Add(d.UploadTTL).Unix(),
		})
	}
}

// Download presigns a GET for the attached asset.
func Download(d Descriptor) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if d.Storage == nil {
			httperr.Render(w, httperr.ServiceUnavailable("storage not configured"))
			return
		}
		id, ok := parseID(w, r)
		if !ok {
			return
		}
		asset, err := d.CurrentAsset(r.Context(), id)
		if err != nil {
			renderOwnerErr(w, err, d.NotFoundMsg)
			return
		}
		if asset.Key == "" {
			httperr.Render(w, httperr.NotFound(d.NoAssetMsg))
			return
		}
		url, err := d.Storage.PresignGet(r.Context(), d.Bucket, asset.Key, d.DownloadTTL)
		if err != nil {
			httperr.Render(w, httperr.Internal("presign failed"))
			return
		}
		out := map[string]any{
			"downloadUrl": url,
			"expiresAt":   time.Now().UTC().Add(d.DownloadTTL).Unix(),
		}
		for k, v := range asset.Extra {
			out[k] = v
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// UpdateKey persists the uploaded object key.
func UpdateKey(d Descriptor) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := parseID(w, r)
		if !ok {
			return
		}
		var req struct {
			ObjectKey string `json:"objectKey"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.Render(w, httperr.BadRequest("invalid json"))
			return
		}
		if strings.TrimSpace(req.ObjectKey) == "" {
			httperr.Render(w, httperr.Unprocessable(map[string]string{"objectKey": "required"}))
			return
		}
		actor := deps.CurrentUserID(r.Context())
		if err := d.SetKey(r.Context(), id, req.ObjectKey, actor); err != nil {
			renderOwnerErr(w, err, d.NotFoundMsg)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func parseID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return 0, false
	}
	return id, true
}

func renderOwnerErr(w http.ResponseWriter, err error, notFoundMsg string) {
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound(notFoundMsg))
		return
	}
	httperr.RenderDBErr(w, err)
}
