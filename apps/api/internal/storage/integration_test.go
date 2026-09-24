package storage_test

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/storage"
)

// Integration test against the dev-compose MinIO. Gated on MINIO_ENDPOINT
// so CI without MinIO still runs unit tests cleanly.
func requireMinio(t *testing.T) storage.Config {
	t.Helper()
	endpoint := os.Getenv("MINIO_ENDPOINT")
	if endpoint == "" {
		t.Skip("MINIO_ENDPOINT not set; skipping MinIO integration test")
	}
	access := os.Getenv("MINIO_ACCESS_KEY")
	secret := os.Getenv("MINIO_SECRET_KEY")
	if access == "" || secret == "" {
		// Local dev defaults from compose.dev.yml.
		access, secret = "minioadmin", "minioadmin"
	}
	return storage.Config{
		Endpoint:  endpoint,
		AccessKey: access,
		SecretKey: secret,
		UseSSL:    os.Getenv("MINIO_USE_SSL") == "true",
	}
}

func TestClient_PutGetRoundtrip(t *testing.T) {
	cfg := requireMinio(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	c, err := storage.New(ctx, cfg)
	require.NoError(t, err)

	key := storage.BuildObjectKey("integration-test", time.Now().UnixNano(), "hello.txt")
	body := []byte("integration-test-payload")

	// Presign returns a relative proxy path now, so exercise the MinIO
	// roundtrip directly via PutObject/GetObject (the proxy handler that
	// fronts these is covered in presign_test.go).
	err = c.PutObject(ctx, storage.BucketClientLogos, key, bytes.NewReader(body), int64(len(body)), "text/plain")
	require.NoError(t, err)

	rc, _, size, err := c.GetObject(ctx, storage.BucketClientLogos, key)
	require.NoError(t, err)
	t.Cleanup(func() { _ = rc.Close() })
	assert.EqualValues(t, len(body), size)
	got, err := io.ReadAll(rc)
	require.NoError(t, err)
	assert.Equal(t, body, got)

	objs, err := c.ListObjects(ctx, storage.BucketClientLogos)
	require.NoError(t, err)
	found := false
	for _, o := range objs {
		if o.Key == key {
			found = true
			assert.EqualValues(t, len(body), o.Size)
			break
		}
	}
	assert.True(t, found, "uploaded key should appear in ListObjects")

	require.NoError(t, c.RemoveObject(ctx, storage.BucketClientLogos, key))
	require.NoError(t, c.RemoveObject(ctx, storage.BucketClientLogos, key), "remove must be idempotent")
}

func TestNew_MissingCreds(t *testing.T) {
	_, err := storage.New(context.Background(), storage.Config{Endpoint: "minio:9000"})
	assert.ErrorIs(t, err, storage.ErrNotConfigured)
}

// An unreachable store fails the boot.
// The first call New makes is the bucket check, so its error names that step.
func TestNew_BadEndpoint(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, err := storage.New(ctx, storage.Config{
		Endpoint:  "127.0.0.1:1",
		AccessKey: "x",
		SecretKey: "y",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "storage: bucket exists check")
}

// A malformed endpoint fails before any network call.
func TestNew_MalformedEndpoint(t *testing.T) {
	_, err := storage.New(context.Background(), storage.Config{
		Endpoint:  "http://minio:9000/path",
		AccessKey: "x",
		SecretKey: "y",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "storage: new client")
}

// Wrong credentials fail the boot too.
func TestNew_WrongCredentials(t *testing.T) {
	cfg := requireMinio(t)
	cfg.SecretKey += "-wrong"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := storage.New(ctx, cfg)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "storage: bucket exists check")
}

// Missing objects and buckets answer typed.
// A missing key is ErrObjectNotFound, which the proxy turns into 404, and
// the existence probe reports false rather than failing the upload.
func TestClient_MissingObjectsAndBuckets(t *testing.T) {
	cfg := requireMinio(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	c, err := storage.New(ctx, cfg)
	require.NoError(t, err)

	const noBucket = "gns-no-such-bucket"
	key := storage.BuildObjectKey("missing", time.Now().UnixNano(), "gone.pdf")

	_, _, _, err = c.GetObject(ctx, storage.BucketPODocs, key)
	assert.ErrorIs(t, err, storage.ErrObjectNotFound)

	exists, err := c.ObjectExists(ctx, storage.BucketPODocs, key)
	require.NoError(t, err)
	assert.False(t, exists)

	exists, err = c.ObjectExists(ctx, noBucket, key)
	require.NoError(t, err)
	assert.False(t, exists)

	err = c.PutObject(ctx, noBucket, key, strings.NewReader("x"), 1, "application/pdf")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "storage: put object")

	_, err = c.ListObjects(ctx, noBucket)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "storage: list")

	_, _, _, err = c.GetObject(ctx, noBucket, key)
	require.Error(t, err)
	assert.NotErrorIs(t, err, storage.ErrObjectNotFound, "a missing bucket is a fault, not a missing file")

	_, _, _, err = c.GetObject(ctx, "", key)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "storage: get object")
}

// An upload without a type is stored as octet-stream.
func TestClient_PutDefaultsContentType(t *testing.T) {
	cfg := requireMinio(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	c, err := storage.New(ctx, cfg)
	require.NoError(t, err)

	key := storage.BuildObjectKey("untyped", time.Now().UnixNano(), "scan.pdf")
	t.Cleanup(func() { _ = c.RemoveObject(context.Background(), storage.BucketPODocs, key) })
	require.NoError(t, c.PutObject(ctx, storage.BucketPODocs, key, strings.NewReader("abc"), 3, ""))

	rc, contentType, size, err := c.GetObject(ctx, storage.BucketPODocs, key)
	require.NoError(t, err)
	t.Cleanup(func() { _ = rc.Close() })
	assert.Equal(t, "application/octet-stream", contentType)
	assert.EqualValues(t, 3, size)

	exists, err := c.ObjectExists(ctx, storage.BucketPODocs, key)
	require.NoError(t, err)
	assert.True(t, exists)
}

// MinIO keeps the cap refusal typed.
// The handler can only answer 413 if the SDK hands back the body reader's
// error unchanged, and a refused upload must leave nothing behind, or the
// retry with a smaller file would hit the overwrite guard.
func TestHandler_OversizeStreamAgainstMinio(t *testing.T) {
	cfg := requireMinio(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	c, err := storage.New(ctx, cfg)
	require.NoError(t, err)

	key := storage.BuildObjectKey("clients", time.Now().UnixNano(), "oversize.png")
	t.Cleanup(func() { _ = c.RemoveObject(context.Background(), storage.BucketClientLogos, key) })
	url := "/storage/object?bucket=" + storage.BucketClientLogos + "&key=" + key

	h := storage.NewHandler(c)
	big := bytes.Repeat([]byte{'x'}, int(storage.MaxBytes(storage.BucketClientLogos))+1)
	req := httptest.NewRequest(http.MethodPut, url, bytes.NewReader(big))
	req.ContentLength = -1
	rec := httptest.NewRecorder()
	h.Put(rec, req)
	assert.Equal(t, http.StatusRequestEntityTooLarge, rec.Code, rec.Body.String())

	exists, err := c.ObjectExists(ctx, storage.BucketClientLogos, key)
	require.NoError(t, err)
	assert.False(t, exists, "a refused upload must not leave an object")

	small := []byte("small-logo")
	req = httptest.NewRequest(http.MethodPut, url, bytes.NewReader(small))
	rec = httptest.NewRecorder()
	h.Put(rec, req)
	assert.Equal(t, http.StatusNoContent, rec.Code, "the retry at the same key must be accepted")
}
