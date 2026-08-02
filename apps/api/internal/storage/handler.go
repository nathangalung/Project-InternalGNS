package storage

import (
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
)

// maxUploadBytes caps a single proxied asset upload.
const maxUploadBytes = 25 << 20 // 25 MB

// Handler proxies asset bytes through the (authenticated) API so MinIO can
// stay on the internal network with no public host.
type Handler struct {
	client *Client
}

func NewHandler(c *Client) *Handler {
	return &Handler{client: c}
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
		http.Error(w, "invalid bucket or key", http.StatusBadRequest)
		return
	}
	// Enforce the per-bucket extension allowlist so the proxy cannot be used
	// to plant arbitrary content types (the presign path already does this).
	if err := ValidateAssetFileName(bucket, key); err != nil {
		http.Error(w, "file type not allowed", http.StatusBadRequest)
		return
	}
	limit := MaxBytes(bucket) // per-bucket policy cap (bucket already validated)
	if limit <= 0 {
		limit = maxUploadBytes
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	defer r.Body.Close()
	if err := h.client.PutObject(r.Context(), bucket, key, r.Body, r.ContentLength, r.Header.Get("Content-Type")); err != nil {
		http.Error(w, "upload failed", http.StatusBadGateway)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Get streams an object back. GET /storage/object?bucket=&key=
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	bucket := r.URL.Query().Get("bucket")
	key := r.URL.Query().Get("key")
	if !allowedBucket(bucket) || !safeKey(key) {
		http.Error(w, "invalid bucket or key", http.StatusBadRequest)
		return
	}
	rc, _, size, err := h.client.GetObject(r.Context(), bucket, key)
	if errors.Is(err, ErrObjectNotFound) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "download failed", http.StatusBadGateway)
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
