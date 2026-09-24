package vendors_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/storage"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/vendors"
)

// proxyKey parses the proxy path.
func proxyKey(t *testing.T, raw string) (bucket, key string) {
	t.Helper()
	u, err := url.Parse(raw)
	require.NoError(t, err)
	assert.Equal(t, "/storage/object", u.Path)
	return u.Query().Get("bucket"), u.Query().Get("key")
}

// Presign, attach, then download.
func TestHandler_Logo_UploadAttachDownload(t *testing.T) {
	srv := mountedSrv(t, testutil.Pool(t))
	id := insertVendor(t, "CV Logo Uji", "Jakarta", true)

	none := doJSON(t, srv, http.MethodGet, vendorPath(id, "/logo/download-url"), nil)
	none.Body.Close()
	require.Equal(t, http.StatusNotFound, none.StatusCode, "no logo attached yet")

	up := doJSON(t, srv, http.MethodGet, vendorPath(id, "/logo/upload-url?fileName=logo.webp"), nil)
	defer up.Body.Close()
	require.Equal(t, http.StatusOK, up.StatusCode)
	var presign struct {
		UploadURL string `json:"uploadUrl"`
		ObjectKey string `json:"objectKey"`
	}
	require.NoError(t, json.NewDecoder(up.Body).Decode(&presign))
	assert.True(t, strings.HasPrefix(presign.ObjectKey, fmt.Sprintf("vendors/%d/", id)), presign.ObjectKey)
	bucket, key := proxyKey(t, presign.UploadURL)
	assert.Equal(t, storage.BucketVendorLogos, bucket)
	assert.Equal(t, presign.ObjectKey, key)

	attach := doJSON(t, srv, http.MethodPatch, vendorPath(id, "/logo"), vendors.UpdateLogoRequest{ObjectKey: presign.ObjectKey})
	attach.Body.Close()
	require.Equal(t, http.StatusNoContent, attach.StatusCode)

	got := doJSON(t, srv, http.MethodGet, vendorPath(id, ""), nil)
	defer got.Body.Close()
	var v vendors.Vendor
	require.NoError(t, json.NewDecoder(got.Body).Decode(&v))
	require.NotNil(t, v.LogoObjectKey)
	assert.Equal(t, presign.ObjectKey, *v.LogoObjectKey)

	down := doJSON(t, srv, http.MethodGet, vendorPath(id, "/logo/download-url"), nil)
	defer down.Body.Close()
	require.Equal(t, http.StatusOK, down.StatusCode)
	var dl struct {
		DownloadURL string `json:"downloadUrl"`
	}
	require.NoError(t, json.NewDecoder(down.Body).Decode(&dl))
	bucket, key = proxyKey(t, dl.DownloadURL)
	assert.Equal(t, storage.BucketVendorLogos, bucket)
	assert.Equal(t, presign.ObjectKey, key)
}

// Missing vendor is 404.
func TestHandler_Logo_MissingVendor(t *testing.T) {
	srv := mountedSrv(t, testutil.Pool(t))
	cases := []struct {
		name   string
		method string
		path   string
		body   any
	}{
		{"upload url", http.MethodGet, "/vendors/999999999/logo/upload-url?fileName=a.png", nil},
		{"upload bad type", http.MethodGet, "/vendors/999999999/logo/upload-url?fileName=a.exe", nil},
		{"download url", http.MethodGet, "/vendors/999999999/logo/download-url", nil},
		{"attach", http.MethodPatch, "/vendors/999999999/logo",
			vendors.UpdateLogoRequest{ObjectKey: "vendors/999999999/a.png"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := doJSON(t, srv, c.method, c.path, c.body)
			defer res.Body.Close()
			assert.Equal(t, http.StatusNotFound, res.StatusCode)
		})
	}
}

// Upload names are validated.
func TestHandler_Logo_UploadRejectsBadName(t *testing.T) {
	srv := mountedSrv(t, testutil.Pool(t))
	id := insertVendor(t, "CV Nama Berkas", "Jakarta", true)
	for _, name := range []string{"", "tool.exe", "katalog.pdf"} {
		t.Run(name, func(t *testing.T) {
			res := doJSON(t, srv, http.MethodGet, vendorPath(id, "/logo/upload-url?fileName="+name), nil)
			defer res.Body.Close()
			assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
		})
	}
}

// No row means not found.
func TestRepo_UpdateLogo_MissingVendor(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := vendors.NewRepo(tx, testutil.Store(t))
	err := repo.UpdateLogo(ctx, 999999999, "vendors/999999999/a.png", seedUserID)
	assert.ErrorIs(t, err, vendors.ErrNotFound)
}
