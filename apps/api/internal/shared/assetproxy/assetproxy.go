// Package assetproxy shares asset routes.
// Every slice mounts the same presigned asset handlers.
package assetproxy

import (
	"context"
	"errors"
	"fmt"
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

// Asset is key plus name.
// FileName reaches the download response only when the descriptor sets
// NamedFile; purchase orders use it to return the original file name.
type Asset struct {
	Key      string
	FileName *string
}

// PresignUpload is a presigned PUT.
// Fields stay alphabetical, the order the old map encoded.
type PresignUpload struct {
	ExpiresAt int64  `json:"expiresAt"`
	ObjectKey string `json:"objectKey"`
	UploadURL string `json:"uploadUrl"`
}

// PresignDownload is a presigned GET.
type PresignDownload struct {
	DownloadURL string `json:"downloadUrl"`
	ExpiresAt   int64  `json:"expiresAt"`
}

// KeyRequest attaches an upload.
type KeyRequest struct {
	ObjectKey string `json:"objectKey"`
}

// PresignFileDownload adds the name.
// FileName is null when the record never stored one.
type PresignFileDownload struct {
	PresignDownload
	FileName *string `json:"fileName"`
}

// Descriptor configures one route set.
type Descriptor struct {
	Storage *storage.Client
	// Objects confirms uploads exist.
	// Nil when storage is not configured.
	Objects   deps.ObjectStore
	Bucket    string
	KeyPrefix string
	// KeySub names a sub-folder.
	// It sits under KeyPrefix/<id>/, so two assets of one record never share
	// a folder and one cannot be attached as the other.
	KeySub string
	// NamedFile adds fileName to downloads.
	NamedFile   bool
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
		httpx.WriteJSON(w, http.StatusOK, PresignUpload{
			ExpiresAt: time.Now().UTC().Add(d.UploadTTL).Unix(),
			ObjectKey: objectKey,
			UploadURL: d.Storage.PresignPut(r.Context(), d.Bucket, objectKey, d.UploadTTL),
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
		out := PresignDownload{
			DownloadURL: d.Storage.PresignGet(r.Context(), d.Bucket, asset.Key, d.DownloadTTL),
			ExpiresAt:   time.Now().UTC().Add(d.DownloadTTL).Unix(),
		}
		if d.NamedFile {
			httpx.WriteJSON(w, http.StatusOK, PresignFileDownload{PresignDownload: out, FileName: asset.FileName})
			return
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
		var req KeyRequest
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
		if !d.uploaded(w, r, objectKey) {
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

// uploaded confirms the upload arrived.
// A valid key only says where an upload would land; the stored key must
// never point at a file that never arrived.
func (d Descriptor) uploaded(w http.ResponseWriter, r *http.Request, key string) bool {
	if d.Objects == nil {
		httperr.Render(w, httperr.ServiceUnavailable("storage not configured"))
		return false
	}
	ok, err := d.Objects.ObjectExists(r.Context(), d.Bucket, key)
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, fmt.Errorf("asset stat: %w", err))
		return false
	}
	if !ok {
		httperr.Render(w, httperr.Unprocessable(map[string]string{
			"objectKey": "Berkas belum terunggah. Unggah ulang berkasnya lalu simpan kembali.",
		}))
		return false
	}
	return true
}

func renderOwnerErr(ctx context.Context, w http.ResponseWriter, err error, notFoundMsg string) {
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound(notFoundMsg))
		return
	}
	httperr.RenderDBErrCtx(ctx, w, err)
}
