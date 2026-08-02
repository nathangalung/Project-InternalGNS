package assetproxy_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/assetproxy"
	"github.com/nathangalung/internalgns/apps/api/internal/storage"
)

var errDB = errors.New("boom")

// base returns a descriptor wired to an in-memory asset.
func base(key string) assetproxy.Descriptor {
	return assetproxy.Descriptor{
		Storage:     &storage.Client{},
		Bucket:      storage.BucketItemImages,
		KeyPrefix:   "items",
		NotFoundMsg: "item not found",
		NoAssetMsg:  "no image attached",
		UploadTTL:   15 * time.Minute,
		DownloadTTL: 1 * time.Hour,
		Exists:      func(context.Context, int64) error { return nil },
		CurrentAsset: func(context.Context, int64) (assetproxy.Asset, error) {
			return assetproxy.Asset{Key: key}, nil
		},
		SetKey: func(context.Context, int64, string, int64) error { return nil },
	}
}

func serve(t *testing.T, method, pattern, target string, h http.HandlerFunc, body string) *httptest.ResponseRecorder {
	t.Helper()
	r := chi.NewRouter()
	r.Method(method, pattern, h)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(method, target, strings.NewReader(body)))
	return rec
}

func decode(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	return out
}

// Storage-nil is checked before the id parse, so a bad id still yields 503.
func TestUpload_NilStorageBeatsBadID(t *testing.T) {
	d := base("")
	d.Storage = nil
	rec := serve(t, http.MethodGet, "/{id}/upload-url", "/abc/upload-url?fileName=x.png", assetproxy.Upload(d), "")
	assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
	assert.Equal(t, "storage not configured", decode(t, rec)["detail"])
}

func TestDownload_NilStorageBeatsBadID(t *testing.T) {
	d := base("")
	d.Storage = nil
	rec := serve(t, http.MethodGet, "/{id}/download-url", "/abc/download-url", assetproxy.Download(d), "")
	assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
}

// UpdateKey has no storage dependency, so a bad id is a 400.
func TestUpdateKey_NilStorageStillParsesID(t *testing.T) {
	d := base("")
	d.Storage = nil
	rec := serve(t, http.MethodPatch, "/{id}", "/abc", assetproxy.UpdateKey(d), `{"objectKey":"k"}`)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Equal(t, "invalid id", decode(t, rec)["detail"])
}

func TestUpload(t *testing.T) {
	tests := []struct {
		name    string
		mutate  func(*assetproxy.Descriptor)
		target  string
		status  int
		detail  string
		field   string
		fieldTo string
	}{
		{
			name:   "not found",
			mutate: func(d *assetproxy.Descriptor) { d.Exists = notFound },
			target: "/1/upload-url?fileName=x.png",
			status: http.StatusNotFound,
			detail: "item not found",
		},
		{
			name:   "db error",
			mutate: func(d *assetproxy.Descriptor) { d.Exists = dbErr },
			target: "/1/upload-url?fileName=x.png",
			status: http.StatusInternalServerError,
		},
		{
			name:    "missing file name",
			target:  "/1/upload-url",
			status:  http.StatusUnprocessableEntity,
			field:   "fileName",
			fieldTo: "required",
		},
		{
			name:    "blank file name",
			target:  "/1/upload-url?fileName=%20%20",
			status:  http.StatusUnprocessableEntity,
			field:   "fileName",
			fieldTo: "required",
		},
		{
			name:    "unsupported extension",
			target:  "/1/upload-url?fileName=x.exe",
			status:  http.StatusUnprocessableEntity,
			field:   "fileName",
			fieldTo: "unsupported file type",
		},
		{
			name:   "bad id",
			target: "/abc/upload-url?fileName=x.png",
			status: http.StatusBadRequest,
			detail: "invalid id",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			d := base("")
			if tc.mutate != nil {
				tc.mutate(&d)
			}
			rec := serve(t, http.MethodGet, "/{id}/upload-url", tc.target, assetproxy.Upload(d), "")
			assert.Equal(t, tc.status, rec.Code)
			if tc.detail != "" {
				assert.Equal(t, tc.detail, decode(t, rec)["detail"])
			}
			if tc.field != "" {
				fields, _ := decode(t, rec)["fields"].(map[string]any)
				assert.Equal(t, tc.fieldTo, fields[tc.field])
			}
		})
	}
}

// The existence check runs before the file-name checks.
func TestUpload_ExistenceBeatsFileName(t *testing.T) {
	d := base("")
	d.Exists = notFound
	rec := serve(t, http.MethodGet, "/{id}/upload-url", "/1/upload-url", assetproxy.Upload(d), "")
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestUpload_OK(t *testing.T) {
	d := base("")
	before := time.Now().UTC().Add(15 * time.Minute).Unix()
	rec := serve(t, http.MethodGet, "/{id}/upload-url", "/42/upload-url?fileName=photo.png", assetproxy.Upload(d), "")
	require.Equal(t, http.StatusOK, rec.Code)

	body := decode(t, rec)
	assert.ElementsMatch(t, []string{"uploadUrl", "objectKey", "expiresAt"}, keys(body))
	key, _ := body["objectKey"].(string)
	assert.True(t, strings.HasPrefix(key, "items/42/"), key)
	assert.True(t, strings.HasSuffix(key, "-photo.png"), key)
	assert.Contains(t, body["uploadUrl"], "bucket="+storage.BucketItemImages)
	assert.GreaterOrEqual(t, int64(body["expiresAt"].(float64)), before)
}

func TestDownload(t *testing.T) {
	t.Run("no asset attached", func(t *testing.T) {
		rec := serve(t, http.MethodGet, "/{id}/download-url", "/1/download-url", assetproxy.Download(base("")), "")
		assert.Equal(t, http.StatusNotFound, rec.Code)
		assert.Equal(t, "no image attached", decode(t, rec)["detail"])
	})
	t.Run("owner missing", func(t *testing.T) {
		d := base("")
		d.CurrentAsset = func(context.Context, int64) (assetproxy.Asset, error) {
			return assetproxy.Asset{}, assetproxy.ErrNotFound
		}
		rec := serve(t, http.MethodGet, "/{id}/download-url", "/1/download-url", assetproxy.Download(d), "")
		assert.Equal(t, http.StatusNotFound, rec.Code)
		assert.Equal(t, "item not found", decode(t, rec)["detail"])
	})
	t.Run("ok", func(t *testing.T) {
		rec := serve(t, http.MethodGet, "/{id}/download-url", "/1/download-url", assetproxy.Download(base("items/1/a.png")), "")
		require.Equal(t, http.StatusOK, rec.Code)
		body := decode(t, rec)
		assert.ElementsMatch(t, []string{"downloadUrl", "expiresAt"}, keys(body))
		assert.Contains(t, body["downloadUrl"], "key=items%2F1%2Fa.png")
	})
}

// Purchase orders return the original file name alongside the URL.
func TestDownload_ExtraFields(t *testing.T) {
	name := "scan.pdf"
	tests := map[string]*string{"present": &name, "null": nil}
	for label, val := range tests {
		t.Run(label, func(t *testing.T) {
			d := base("")
			d.CurrentAsset = func(context.Context, int64) (assetproxy.Asset, error) {
				return assetproxy.Asset{Key: "po/1/a.pdf", Extra: map[string]any{"fileName": val}}, nil
			}
			rec := serve(t, http.MethodGet, "/{id}/download-url", "/1/download-url", assetproxy.Download(d), "")
			require.Equal(t, http.StatusOK, rec.Code)
			body := decode(t, rec)
			assert.ElementsMatch(t, []string{"downloadUrl", "expiresAt", "fileName"}, keys(body))
			if val == nil {
				assert.Nil(t, body["fileName"])
			} else {
				assert.Equal(t, name, body["fileName"])
			}
		})
	}
}

func TestUpdateKey(t *testing.T) {
	t.Run("invalid json", func(t *testing.T) {
		rec := serve(t, http.MethodPatch, "/{id}", "/1", assetproxy.UpdateKey(base("")), "not json")
		assert.Equal(t, http.StatusBadRequest, rec.Code)
		assert.Equal(t, "invalid json", decode(t, rec)["detail"])
	})
	t.Run("blank object key", func(t *testing.T) {
		rec := serve(t, http.MethodPatch, "/{id}", "/1", assetproxy.UpdateKey(base("")), `{"objectKey":"  "}`)
		assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
		fields, _ := decode(t, rec)["fields"].(map[string]any)
		assert.Equal(t, "required", fields["objectKey"])
	})
	t.Run("owner missing", func(t *testing.T) {
		d := base("")
		d.SetKey = func(context.Context, int64, string, int64) error { return assetproxy.ErrNotFound }
		rec := serve(t, http.MethodPatch, "/{id}", "/1", assetproxy.UpdateKey(d), `{"objectKey":"k"}`)
		assert.Equal(t, http.StatusNotFound, rec.Code)
		assert.Equal(t, "item not found", decode(t, rec)["detail"])
	})
	// Validation trims, persistence does not.
	t.Run("persists untrimmed key", func(t *testing.T) {
		var got string
		var gotID, gotActor int64
		d := base("")
		d.SetKey = func(_ context.Context, id int64, key string, actor int64) error {
			gotID, got, gotActor = id, key, actor
			return nil
		}
		rec := serve(t, http.MethodPatch, "/{id}", "/7", assetproxy.UpdateKey(d), `{"objectKey":" items/1/a.png "}`)
		assert.Equal(t, http.StatusNoContent, rec.Code)
		assert.Empty(t, rec.Body.String())
		assert.Equal(t, " items/1/a.png ", got)
		assert.Equal(t, int64(7), gotID)
		assert.Equal(t, int64(0), gotActor)
	})
}

func notFound(context.Context, int64) error { return assetproxy.ErrNotFound }
func dbErr(context.Context, int64) error    { return errDB }

func keys(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
