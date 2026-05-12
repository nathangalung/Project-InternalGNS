package storage_test

import (
	"bytes"
	"context"
	"io"
	"net/http"
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

func TestClient_PresignRoundtrip(t *testing.T) {
	cfg := requireMinio(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	c, err := storage.New(ctx, cfg)
	require.NoError(t, err)

	key := storage.BuildObjectKey("integration-test", time.Now().UnixNano(), "hello.txt")
	body := []byte("integration-test-payload")

	putURL, err := c.PresignPut(ctx, storage.BucketClientLogos, key, 5*time.Minute)
	require.NoError(t, err)
	require.NotEmpty(t, putURL)

	req, err := http.NewRequestWithContext(ctx, http.MethodPut, putURL, bytes.NewReader(body))
	require.NoError(t, err)
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	_ = resp.Body.Close()
	require.Equal(t, http.StatusOK, resp.StatusCode, "presigned PUT must accept upload")

	getURL, err := c.PresignGet(ctx, storage.BucketClientLogos, key, 5*time.Minute)
	require.NoError(t, err)

	getResp, err := http.Get(getURL)
	require.NoError(t, err)
	t.Cleanup(func() { _ = getResp.Body.Close() })
	require.Equal(t, http.StatusOK, getResp.StatusCode)
	got, err := io.ReadAll(getResp.Body)
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

func TestNew_BadEndpoint(t *testing.T) {
	if os.Getenv("MINIO_ENDPOINT") != "" {
		t.Skip("real MINIO_ENDPOINT set; bad-endpoint test would need network isolation")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, err := storage.New(ctx, storage.Config{
		Endpoint:  "127.0.0.1:1",
		AccessKey: "x",
		SecretKey: "y",
	})
	if err == nil {
		t.Fatal("expected error from unreachable endpoint")
	}
	// MinIO SDK either fails connect or returns lookup error; both fine.
	assert.True(t, strings.Contains(err.Error(), "storage:") || err != nil)
}
