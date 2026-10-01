package assetproxy_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
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

// fakeObjects answers stat calls.
type fakeObjects struct {
	found bool
	err   error
	asked []string
}

func (f *fakeObjects) ObjectExists(_ context.Context, bucket, key string) (bool, error) {
	f.asked = append(f.asked, bucket+"/"+key)
	return f.found, f.err
}

// base wires an in-memory asset.
func base(key string) assetproxy.Descriptor {
	return assetproxy.Descriptor{
		Storage:     &storage.Client{},
		Objects:     &fakeObjects{found: true},
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

// Nil storage beats bad ids.
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

// UpdateKey parses ids without storage.
// Storage is checked last, so a bad id is still a 400.
func TestUpdateKey_NilStorageStillParsesID(t *testing.T) {
	d := base("")
	d.Storage = nil
	d.Objects = nil
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

// Existence check precedes name checks.
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
	t.Run("bad id", func(t *testing.T) {
		rec := serve(t, http.MethodGet, "/{id}/download-url", "/x/download-url", assetproxy.Download(base("items/1/a.png")), "")
		assert.Equal(t, http.StatusBadRequest, rec.Code)
		assert.Equal(t, "invalid id", decode(t, rec)["detail"])
	})
	t.Run("owner lookup fails", func(t *testing.T) {
		d := base("")
		d.CurrentAsset = func(context.Context, int64) (assetproxy.Asset, error) {
			return assetproxy.Asset{}, errors.New("connection reset")
		}
		rec := serve(t, http.MethodGet, "/{id}/download-url", "/1/download-url", assetproxy.Download(d), "")
		assert.Equal(t, http.StatusInternalServerError, rec.Code)
		assert.NotContains(t, rec.Body.String(), "connection reset", "the cause stays in the log")
	})
}

// Named files report the name.
// Purchase orders return the original file name alongside the URL.
func TestDownload_NamedFile(t *testing.T) {
	name := "scan.pdf"
	tests := map[string]*string{"present": &name, "null": nil}
	for label, val := range tests {
		t.Run(label, func(t *testing.T) {
			d := base("")
			d.NamedFile = true
			d.CurrentAsset = func(context.Context, int64) (assetproxy.Asset, error) {
				return assetproxy.Asset{Key: "po/1/a.pdf", FileName: val}, nil
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

// Bodies keep the map bytes.
// The responses were maps, which encode keys sorted; the named structs
// must emit the same keys in the same order.
func TestPresignBodies_KeepLegacyBytes(t *testing.T) {
	named := "scan.pdf"
	tests := []struct {
		name   string
		mutate func(*assetproxy.Descriptor)
		target string
		h      func(assetproxy.Descriptor) http.HandlerFunc
		want   string
	}{
		{
			name:   "upload",
			target: "/42/upload-url?fileName=photo.png",
			h:      assetproxy.Upload,
			want:   `^\{"expiresAt":\d+,"objectKey":"items/42/[^"]+-photo\.png","uploadUrl":"[^"]+"\}\n$`,
		},
		{
			name:   "download",
			target: "/1/download-url",
			h:      assetproxy.Download,
			want:   `^\{"downloadUrl":"[^"]+","expiresAt":\d+\}\n$`,
		},
		{
			name: "named download",
			mutate: func(d *assetproxy.Descriptor) {
				d.NamedFile = true
				d.CurrentAsset = func(context.Context, int64) (assetproxy.Asset, error) {
					return assetproxy.Asset{Key: "items/1/a.png", FileName: &named}, nil
				}
			},
			target: "/1/download-url",
			h:      assetproxy.Download,
			want:   `^\{"downloadUrl":"[^"]+","expiresAt":\d+,"fileName":"scan\.pdf"\}\n$`,
		},
		{
			name: "named download without name",
			mutate: func(d *assetproxy.Descriptor) {
				d.NamedFile = true
			},
			target: "/1/download-url",
			h:      assetproxy.Download,
			want:   `^\{"downloadUrl":"[^"]+","expiresAt":\d+,"fileName":null\}\n$`,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			d := base("items/1/a.png")
			if tc.mutate != nil {
				tc.mutate(&d)
			}
			pattern := "/{id}/download-url"
			if strings.Contains(tc.target, "upload-url") {
				pattern = "/{id}/upload-url"
			}
			rec := serve(t, http.MethodGet, pattern, tc.target, tc.h(d), "")
			require.Equal(t, http.StatusOK, rec.Code)
			assert.Regexp(t, tc.want, rec.Body.String())
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
		rec := serve(t, http.MethodPatch, "/{id}", "/1", assetproxy.UpdateKey(d), `{"objectKey":"items/1/1790-a.png"}`)
		assert.Equal(t, http.StatusNotFound, rec.Code)
		assert.Equal(t, "item not found", decode(t, rec)["detail"])
	})
	// The stored key must address a real object, so the trimmed value is what
	// is persisted.
	t.Run("persists the trimmed key", func(t *testing.T) {
		var got string
		var gotID, gotActor int64
		d := base("")
		d.SetKey = func(_ context.Context, id int64, key string, actor int64) error {
			gotID, got, gotActor = id, key, actor
			return nil
		}
		rec := serve(t, http.MethodPatch, "/{id}", "/7", assetproxy.UpdateKey(d), `{"objectKey":" items/7/1790-a.png "}`)
		assert.Equal(t, http.StatusNoContent, rec.Code)
		assert.Empty(t, rec.Body.String())
		assert.Equal(t, "items/7/1790-a.png", got)
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

// logCtxCapture records handler contexts.
type logCtxCapture struct {
	slog.Handler
	seen []context.Context
}

func (h *logCtxCapture) Handle(ctx context.Context, _ slog.Record) error {
	h.seen = append(h.seen, ctx)
	return nil
}

func (h *logCtxCapture) Enabled(context.Context, slog.Level) bool { return true }

type reqProbeKey struct{}

// Repo failures log request context.
// A failure on any asset route must log with the request context, so the
// slog handler can stamp request_id onto the 500 line.
func TestAssetRoutes_ServerErrorLogsRequestContext(t *testing.T) {
	cases := []struct {
		name    string
		method  string
		pattern string
		target  string
		body    string
		handler func(assetproxy.Descriptor) http.HandlerFunc
	}{
		{"download", http.MethodGet, "/{id}/image", "/7/image", "", assetproxy.Download},
		{"update key", http.MethodPatch, "/{id}/image", "/7/image", `{"objectKey":"items/7/a.png"}`, assetproxy.UpdateKey},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			capture := &logCtxCapture{Handler: slog.NewJSONHandler(io.Discard, nil)}
			prev := slog.Default()
			slog.SetDefault(slog.New(capture))
			t.Cleanup(func() { slog.SetDefault(prev) })

			d := base("items/7/a.png")
			d.CurrentAsset = func(context.Context, int64) (assetproxy.Asset, error) { return assetproxy.Asset{}, errDB }
			d.SetKey = func(context.Context, int64, string, int64) error { return errDB }

			r := chi.NewRouter()
			r.Method(c.method, c.pattern, c.handler(d))
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(c.method, c.target, strings.NewReader(c.body))
			req = req.WithContext(context.WithValue(req.Context(), reqProbeKey{}, "req-9"))
			r.ServeHTTP(rec, req)

			assert.Equal(t, http.StatusInternalServerError, rec.Code)
			require.Len(t, capture.seen, 1, "expected exactly one log record")
			assert.Equal(t, "req-9", capture.seen[0].Value(reqProbeKey{}))
		})
	}
}

// Sub-folder assets keep their folder.
// Upload writes into it and UpdateKey accepts nothing outside it.
func TestKeySub_BindsTheFolder(t *testing.T) {
	d := base("")
	d.KeySub = "sub"
	rec := serve(t, http.MethodGet, "/{id}/upload-url", "/7/upload-url?fileName=photo.png", assetproxy.Upload(d), "")
	require.Equal(t, http.StatusOK, rec.Code)
	key, _ := decode(t, rec)["objectKey"].(string)
	assert.True(t, strings.HasPrefix(key, "items/7/sub/"), key)

	cases := []struct {
		name   string
		key    string
		status int
	}{
		{"the uploaded key", key, http.StatusNoContent},
		{"the record's root folder", "items/7/1790-a.png", http.StatusUnprocessableEntity},
		{"another record's sub-folder", "items/8/sub/1790-a.png", http.StatusUnprocessableEntity},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := serve(t, http.MethodPatch, "/{id}", "/7", assetproxy.UpdateKey(d), `{"objectKey":"`+c.key+`"}`)
			assert.Equal(t, c.status, rec.Code)
		})
	}
}

// Attach refuses foreign keys.
// The attach endpoint takes the key from the request body, so it must refuse
// any key that does not belong to the record being attached to. Client 42
// carries logo_object_key='../../etc/x' because it did not.
func TestUpdateKey_RejectsForeignKeys(t *testing.T) {
	cases := []struct {
		name string
		key  string
	}{
		{"another record", "items/8/1790-a.png"},
		{"prefix overlap", "items/70/1790-a.png"},
		{"other namespace", "clients/7/1790-a.png"},
		{"traversal", "../../etc/x"},
		{"absolute", "/items/7/1790-a.png"},
		{"disallowed extension", "items/7/1790-a.exe"},
		{"bare prefix", "items/7/"},
		{"a sub-folder asset", "items/7/sub/1790-a.png"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var persisted bool
			d := base("")
			d.SetKey = func(context.Context, int64, string, int64) error {
				persisted = true
				return nil
			}
			rec := serve(t, http.MethodPatch, "/{id}", "/7", assetproxy.UpdateKey(d),
				`{"objectKey":"`+c.key+`"}`)
			assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
			assert.False(t, persisted, "a foreign key must never reach the repo")
		})
	}
}

// Missing owner beats key check.
// A missing owner is reported as 404, not as a malformed key.
func TestUpdateKey_OwnerMissingBeatsKeyCheck(t *testing.T) {
	d := base("")
	d.Exists = func(context.Context, int64) error { return assetproxy.ErrNotFound }
	rec := serve(t, http.MethodPatch, "/{id}", "/99999999", assetproxy.UpdateKey(d),
		`{"objectKey":"items/1/1790-a.png"}`)
	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.Equal(t, "item not found", decode(t, rec)["detail"])
}

// Attach needs the uploaded object.
// A valid key only says where an upload would land, so the stored key must
// never point at a file that never arrived.
func TestUpdateKey_ObjectMustExist(t *testing.T) {
	const key = "items/7/1790-a.png"
	cases := []struct {
		name      string
		store     *fakeObjects
		key       string
		status    int
		detail    string
		field     string
		asked     bool
		persisted bool
	}{
		{
			name:   "storage not configured",
			key:    key,
			status: http.StatusServiceUnavailable,
			detail: "storage not configured",
		},
		{
			name:   "a foreign key before storage",
			key:    "items/8/1790-a.png",
			status: http.StatusUnprocessableEntity,
			detail: "Berkas tidak dikenali. Unggah ulang berkasnya lalu simpan kembali.",
			field:  "Berkas tidak dikenali. Unggah ulang berkasnya lalu simpan kembali.",
		},
		{
			name:   "never uploaded",
			store:  &fakeObjects{},
			key:    key,
			status: http.StatusUnprocessableEntity,
			detail: "Berkas belum terunggah. Unggah ulang berkasnya lalu simpan kembali.",
			field:  "Berkas belum terunggah. Unggah ulang berkasnya lalu simpan kembali.",
			asked:  true,
		},
		{
			name:   "storage fails",
			store:  &fakeObjects{err: errDB},
			key:    key,
			status: http.StatusInternalServerError,
			detail: "internal server error",
			asked:  true,
		},
		{
			name:      "uploaded",
			store:     &fakeObjects{found: true},
			key:       key,
			status:    http.StatusNoContent,
			asked:     true,
			persisted: true,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var persisted bool
			d := base("")
			d.Objects = nil
			if c.store != nil {
				d.Objects = c.store
			}
			d.SetKey = func(context.Context, int64, string, int64) error {
				persisted = true
				return nil
			}
			rec := serve(t, http.MethodPatch, "/{id}", "/7", assetproxy.UpdateKey(d), `{"objectKey":" `+c.key+` "}`)
			require.Equal(t, c.status, rec.Code)
			if c.detail != "" {
				body := decode(t, rec)
				assert.Equal(t, c.detail, body["detail"])
				fields, _ := body["fields"].(map[string]any)
				if c.field != "" {
					assert.Equal(t, c.field, fields["objectKey"])
				}
			}
			if c.store != nil {
				var want []string
				if c.asked {
					want = []string{storage.BucketItemImages + "/" + c.key}
				}
				assert.Equal(t, want, c.store.asked)
			}
			assert.Equal(t, c.persisted, persisted)
		})
	}
}

// RemoveKey detaches the asset.
func TestRemoveKey(t *testing.T) {
	cases := []struct {
		name       string
		target     string
		exists     error
		clear      error
		wantStatus int
		wantDetail string
		wantClear  bool
	}{
		{name: "bad id", target: "/abc/image", wantStatus: http.StatusBadRequest, wantDetail: "invalid id"},
		{name: "owner missing", target: "/7/image", exists: assetproxy.ErrNotFound, wantStatus: http.StatusNotFound, wantDetail: "item not found"},
		{name: "owner read fails", target: "/7/image", exists: errDB, wantStatus: http.StatusInternalServerError},
		{name: "clear vanished owner", target: "/7/image", clear: assetproxy.ErrNotFound, wantStatus: http.StatusNotFound, wantDetail: "item not found", wantClear: true},
		{name: "clear fails", target: "/7/image", clear: errDB, wantStatus: http.StatusInternalServerError, wantClear: true},
		{name: "cleared", target: "/7/image", wantStatus: http.StatusNoContent, wantClear: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d := base("items/7/a.png")
			d.Exists = func(context.Context, int64) error { return tc.exists }
			var clearedID int64
			d.ClearKey = func(_ context.Context, id, _ int64) error {
				clearedID = id
				return tc.clear
			}
			rec := serve(t, http.MethodDelete, "/{id}/image", tc.target, assetproxy.RemoveKey(d), "")
			assert.Equal(t, tc.wantStatus, rec.Code)
			if tc.wantDetail != "" {
				assert.Equal(t, tc.wantDetail, decode(t, rec)["detail"])
			}
			if tc.wantClear {
				assert.Equal(t, int64(7), clearedID)
			} else {
				assert.Zero(t, clearedID, "nothing cleared")
			}
		})
	}
}
