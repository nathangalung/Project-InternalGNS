package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
)

// maxUploadBytes caps a single proxied asset upload.
const maxUploadBytes = 25 << 20 // 25 MB

// objectStore is the slice of Client the byte proxy uses.
// Named so the proxy's refusal rules can be tested without a live MinIO.
type objectStore interface {
	PutObject(ctx context.Context, bucket, objectKey string, r io.Reader, size int64, contentType string) error
	GetObject(ctx context.Context, bucket, objectKey string) (io.ReadCloser, string, int64, error)
	ObjectExists(ctx context.Context, bucket, objectKey string) (bool, error)
}

// Handler proxies asset bytes through the (authenticated) API so MinIO can
// stay on the internal network with no public host.
type Handler struct {
	store objectStore
}

func NewHandler(c *Client) *Handler {
	if c == nil {
		return &Handler{}
	}
	return &Handler{store: c}
}

// newHandlerWithStore builds a handler on a fake store.
func newHandlerWithStore(s objectStore) *Handler {
	return &Handler{store: s}
}

func allowedBucket(b string) bool {
	for _, x := range AllBuckets {
		if x == b {
			return true
		}
	}
	return false
}

// safeKey rejects empty, absolute, or traversal keys. The ".." check is per
// segment, not a substring match, so legitimate filenames containing
// consecutive dots (e.g. "report..final.pdf") are still accepted.
func safeKey(k string) bool {
	if k == "" || strings.HasPrefix(k, "/") {
		return false
	}
	for _, seg := range strings.Split(k, "/") {
		if seg == "." || seg == ".." {
			return false
		}
	}
	return true
}

// Put streams the request body into MinIO. PUT /storage/object?bucket=&key=
func (h *Handler) Put(w http.ResponseWriter, r *http.Request) {
	bucket := r.URL.Query().Get("bucket")
	key := r.URL.Query().Get("key")
	if !allowedBucket(bucket) || !safeKey(key) {
		httperr.Render(w, httperr.BadRequest("invalid bucket or key"))
		return
	}
	// Enforce the per-bucket extension allowlist so the proxy cannot be used
	// to plant arbitrary content types (the presign path already does this).
	if err := ValidateAssetFileName(bucket, key); err != nil {
		httperr.Render(w, httperr.BadRequest("file type not allowed"))
		return
	}
	if h.store == nil {
		httperr.Render(w, httperr.ServiceUnavailable("storage not configured"))
		return
	}
	limit := MaxBytes(bucket) // per-bucket policy cap (bucket already validated)
	if limit <= 0 {
		limit = maxUploadBytes
	}
	// A declared length past the cap is refused before any byte is read.
	if r.ContentLength > limit {
		renderTooLarge(w, limit)
		return
	}
	// The key comes from the client, so a PUT is a create, never a replace:
	// otherwise any role holding the bucket could overwrite another record's
	// stored document with its own bytes.
	exists, err := h.store.ObjectExists(r.Context(), bucket, key)
	if err != nil {
		renderStoreErr(r.Context(), w, "stat", bucket, key, err, "upload failed")
		return
	}
	if exists {
		httperr.Render(w, httperr.Conflict("object already exists"))
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	defer r.Body.Close()
	if err := h.store.PutObject(r.Context(), bucket, key, r.Body, r.ContentLength, r.Header.Get("Content-Type")); err != nil {
		// A streamed body that outgrows the cap is the caller's file, not
		// a store fault.
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			renderTooLarge(w, limit)
			return
		}
		renderStoreErr(r.Context(), w, "put", bucket, key, err, "upload failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Get streams an object back. GET /storage/object?bucket=&key=
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	bucket := r.URL.Query().Get("bucket")
	key := r.URL.Query().Get("key")
	if !allowedBucket(bucket) || !safeKey(key) {
		httperr.Render(w, httperr.BadRequest("invalid bucket or key"))
		return
	}
	if h.store == nil {
		httperr.Render(w, httperr.ServiceUnavailable("storage not configured"))
		return
	}
	rc, _, size, err := h.store.GetObject(r.Context(), bucket, key)
	if errors.Is(err, ErrObjectNotFound) {
		httperr.Render(w, httperr.NotFound("not found"))
		return
	}
	if err != nil {
		renderStoreErr(r.Context(), w, "get", bucket, key, err, "download failed")
		return
	}
	defer rc.Close()
	// Derive the type from the allow-listed extension, not the stored (and
	// therefore attacker-influenced) content type, and force a download so a
	// document can never execute as HTML on the API origin. Images embedded
	// via <img> still render; only direct navigation is neutralized.
	ct := mime.TypeByExtension(strings.ToLower(path.Ext(key)))
	if ct == "" {
		ct = "application/octet-stream"
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", path.Base(key)))
	if size > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	}
	w.Header().Set("Cache-Control", "private, max-age=300")
	_, _ = io.Copy(w, rc)
}

// Refuses an oversize file.
func renderTooLarge(w http.ResponseWriter, limit int64) {
	httperr.Render(w, httperr.PayloadTooLarge(
		fmt.Sprintf("Ukuran berkas melebihi batas %d MB. Pilih berkas yang lebih kecil.", limit>>20)))
}

// Logs a store failure with its cause.
// The body stays generic; the log line names the operation and object under
// the request context, so request_id joins it to its access-log line.
func renderStoreErr(ctx context.Context, w http.ResponseWriter, op, bucket, key string, err error, detail string) {
	slog.ErrorContext(ctx, "object store failed",
		"op", op, "bucket", bucket, "key", key,
		"error", fmt.Errorf("storage: %s %s/%s: %w", op, bucket, key, err).Error())
	httperr.Render(w, httperr.BadGateway(detail))
}
