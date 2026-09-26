package clients_test

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/storage"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
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
	id := strconv.FormatInt(newClient(t), 10)
	base := "/clients/" + id

	none := doJSON(t, srv, http.MethodGet, base+"/logo/download-url", nil)
	none.Body.Close()
	require.Equal(t, http.StatusNotFound, none.StatusCode, "no logo attached yet")

	up := doJSON(t, srv, http.MethodGet, base+"/logo/upload-url?fileName="+url.QueryEscape("Logo PT.png"), nil)
	defer up.Body.Close()
	require.Equal(t, http.StatusOK, up.StatusCode)
	var presign struct {
		UploadURL string `json:"uploadUrl"`
		ObjectKey string `json:"objectKey"`
		ExpiresAt int64  `json:"expiresAt"`
	}
	require.NoError(t, json.NewDecoder(up.Body).Decode(&presign))
	assert.True(t, strings.HasPrefix(presign.ObjectKey, "clients/"+id+"/"), presign.ObjectKey)
	assert.True(t, strings.HasSuffix(presign.ObjectKey, ".png"), presign.ObjectKey)
	assert.Positive(t, presign.ExpiresAt)
	bucket, key := proxyKey(t, presign.UploadURL)
	assert.Equal(t, storage.BucketClientLogos, bucket)
	assert.Equal(t, presign.ObjectKey, key)

	attach := doJSON(t, srv, http.MethodPatch, base+"/logo", clients.UpdateLogoRequest{ObjectKey: presign.ObjectKey})
	attach.Body.Close()
	require.Equal(t, http.StatusNoContent, attach.StatusCode)

	got := doJSON(t, srv, http.MethodGet, base, nil)
	defer got.Body.Close()
	var c clients.Client
	require.NoError(t, json.NewDecoder(got.Body).Decode(&c))
	require.NotNil(t, c.LogoObjectKey)
	assert.Equal(t, presign.ObjectKey, *c.LogoObjectKey)

	down := doJSON(t, srv, http.MethodGet, base+"/logo/download-url", nil)
	defer down.Body.Close()
	require.Equal(t, http.StatusOK, down.StatusCode)
	var dl struct {
		DownloadURL string `json:"downloadUrl"`
	}
	require.NoError(t, json.NewDecoder(down.Body).Decode(&dl))
	bucket, key = proxyKey(t, dl.DownloadURL)
	assert.Equal(t, storage.BucketClientLogos, bucket)
	assert.Equal(t, presign.ObjectKey, key)
}

// Upload names are validated.
func TestHandler_Logo_UploadRejectsBadName(t *testing.T) {
	srv := mountedSrv(t, testutil.Pool(t))
	id := strconv.FormatInt(newClient(t), 10)
	for _, name := range []string{"", "%20", "script.exe", "logo.pdf"} {
		t.Run(name, func(t *testing.T) {
			res := doJSON(t, srv, http.MethodGet, "/clients/"+id+"/logo/upload-url?fileName="+name, nil)
			defer res.Body.Close()
			assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
		})
	}
}

// Missing client is 404.
func TestHandler_Logo_MissingClient(t *testing.T) {
	srv := mountedSrv(t, testutil.Pool(t))
	cases := []struct {
		name   string
		method string
		path   string
		body   any
	}{
		{"upload url", http.MethodGet, "/clients/999999999/logo/upload-url?fileName=a.png", nil},
		{"download url", http.MethodGet, "/clients/999999999/logo/download-url", nil},
		{"attach", http.MethodPatch, "/clients/999999999/logo",
			clients.UpdateLogoRequest{ObjectKey: "clients/999999999/a.png"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := doJSON(t, srv, c.method, c.path, c.body)
			defer res.Body.Close()
			assert.Equal(t, http.StatusNotFound, res.StatusCode)
		})
	}
}

// No row means not found.
func TestRepo_UpdateLogo_MissingClient(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := clients.NewRepo(tx, testutil.Store(t))
	err := repo.UpdateLogo(ctx, 999999999, "clients/999999999/a.png", seedUserID)
	assert.ErrorIs(t, err, clients.ErrNotFound)
}
