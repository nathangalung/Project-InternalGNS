// Package assetproxy shares asset routes.
// Every slice mounts the same presigned asset handlers.
package assetproxy

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httpx"
	"github.com/nathangalung/internalgns/apps/api/internal/storage"
)

// ErrNotFound signals missing owners.
var ErrNotFound = errors.New("assetproxy: not found")

// Asset is key plus extras.
// Extra is merged into the download response; purchase orders use it to
// return the original file name alongside the URL.
type Asset struct {
	Key   string
	Extra map[string]any
}

// Descriptor configures one route set.
type Descriptor struct {
	Storage   *storage.Client
	Bucket    string
	KeyPrefix string
	// KeySub names a sub-folder.
	// It sits under KeyPrefix/<id>/, so two assets of one record never share
	// a folder and one cannot be attached as the other.
	KeySub      string
	NotFoundMsg string
	NoAssetMsg  string
	UploadTTL   time.Duration
	DownloadTTL time.Duration

	// Exists checks the owner row.
	// A missing row returns ErrNotFound.
	Exists func(ctx context.Context, id int64) error
	// CurrentAsset returns the attachment.
	// The Key is empty when none is attached.
	CurrentAsset func(ctx context.Context, id int64) (Asset, error)
	// SetKey persists the object key.
	// It is stored against the owner row.
	SetKey func(ctx context.Context, id int64, key string, actor int64) error
}

// folder is a record's folder.
func (d Descriptor) folder(id int64) string {
	return storage.OwnerFolder(d.KeyPrefix, id, d.KeySub)
}

// Upload presigns a new PUT.
func Upload(d Descriptor) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if d.Storage == nil {
			httperr.Render(w, httperr.ServiceUnavailable("storage not configured"))
			return
		}
		id, ok := httpx.PathID(w, r, "id", "invalid id")
		if !ok {
			return
		}
		if err := d.Exists(r.Context(), id); err != nil {
			renderOwnerErr(r.Context(), w, err, d.NotFoundMsg)
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
		objectKey := storage.BuildFolderKey(d.folder(id), fileName)
		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"uploadUrl": d.Storage.PresignPut(r.Context(), d.Bucket, objectKey, d.UploadTTL),
			"objectKey": objectKey,
			"expiresAt": time.Now().UTC().Add(d.UploadTTL).Unix(),
		})
	}
}

// Download presigns the attached GET.
func Download(d Descriptor) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if d.Storage == nil {
			httperr.Render(w, httperr.ServiceUnavailable("storage not configured"))
			return
		}
		id, ok := httpx.PathID(w, r, "id", "invalid id")
		if !ok {
			return
		}
		asset, err := d.CurrentAsset(r.Context(), id)
		if err != nil {
			renderOwnerErr(r.Context(), w, err, d.NotFoundMsg)
			return
		}
		if asset.Key == "" {
			httperr.Render(w, httperr.NotFound(d.NoAssetMsg))
			return
		}
		out := map[string]any{
			"downloadUrl": d.Storage.PresignGet(r.Context(), d.Bucket, asset.Key, d.DownloadTTL),
			"expiresAt":   time.Now().UTC().Add(d.DownloadTTL).Unix(),
		}
		for k, v := range asset.Extra {
			out[k] = v
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// UpdateKey persists uploaded keys.
func UpdateKey(d Descriptor) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := httpx.PathID(w, r, "id", "invalid id")
		if !ok {
			return
		}
		var req struct {
			ObjectKey string `json:"objectKey"`
		}
		if !httpx.DecodeJSON(w, r, &req) {
			return
		}
		objectKey := strings.TrimSpace(req.ObjectKey)
		if objectKey == "" {
			httperr.Render(w, httperr.Unprocessable(map[string]string{"objectKey": "required"}))
			return
		}
		// Owner first, so a key aimed at a record that does not exist still
		// reads as 404 rather than as a malformed key.
		if err := d.Exists(r.Context(), id); err != nil {
			renderOwnerErr(r.Context(), w, err, d.NotFoundMsg)
			return
		}
		// The key arrives from the client, so it has to prove it addresses an
		// upload made for this record: otherwise a caller could attach any
		// object in the bucket, or a traversal path outside it.
		if err := storage.ValidateFolderKey(d.Bucket, d.folder(id), objectKey); err != nil {
			httperr.Render(w, httperr.Unprocessable(map[string]string{
				"objectKey": "Berkas tidak dikenali. Unggah ulang berkasnya lalu simpan kembali.",
			}))
			return
		}
		actor := deps.CurrentUserID(r.Context())
		if err := d.SetKey(r.Context(), id, objectKey, actor); err != nil {
			renderOwnerErr(r.Context(), w, err, d.NotFoundMsg)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func renderOwnerErr(ctx context.Context, w http.ResponseWriter, err error, notFoundMsg string) {
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound(notFoundMsg))
		return
	}
	httperr.RenderDBErrCtx(ctx, w, err)
}
