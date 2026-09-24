package items_test

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
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
func TestHandler_Image_UploadAttachDownload(t *testing.T) {
	srv := mountedSrv(t, testutil.Pool(t))
	it := createItem(t, items.CreateItemRequest{Name: uniqueItemName("IMAGE")})
	base := "/items/" + itoa(it.ID)

	none := doJSON(t, srv, http.MethodGet, base+"/image/download-url", nil)
	none.Body.Close()
	require.Equal(t, http.StatusNotFound, none.StatusCode, "no image attached yet")

	up := doJSON(t, srv, http.MethodGet, base+"/image/upload-url?fileName=foto.jpg", nil)
	defer up.Body.Close()
	require.Equal(t, http.StatusOK, up.StatusCode)
	var presign struct {
		UploadURL string `json:"uploadUrl"`
		ObjectKey string `json:"objectKey"`
	}
	require.NoError(t, json.NewDecoder(up.Body).Decode(&presign))
	assert.True(t, strings.HasPrefix(presign.ObjectKey, "items/"+itoa(it.ID)+"/"), presign.ObjectKey)
	bucket, key := proxyKey(t, presign.UploadURL)
	assert.Equal(t, storage.BucketItemImages, bucket)
	assert.Equal(t, presign.ObjectKey, key)

	attach := doJSON(t, srv, http.MethodPatch, base+"/image", items.UpdateImageRequest{ObjectKey: presign.ObjectKey})
	attach.Body.Close()
	require.Equal(t, http.StatusNoContent, attach.StatusCode)

	got := doJSON(t, srv, http.MethodGet, base, nil)
	defer got.Body.Close()
	var item items.Item
	require.NoError(t, json.NewDecoder(got.Body).Decode(&item))
	require.NotNil(t, item.ImageObjectKey)
	assert.Equal(t, presign.ObjectKey, *item.ImageObjectKey)

	down := doJSON(t, srv, http.MethodGet, base+"/image/download-url", nil)
	defer down.Body.Close()
	require.Equal(t, http.StatusOK, down.StatusCode)
	var dl struct {
		DownloadURL string `json:"downloadUrl"`
	}
	require.NoError(t, json.NewDecoder(down.Body).Decode(&dl))
	bucket, key = proxyKey(t, dl.DownloadURL)
	assert.Equal(t, storage.BucketItemImages, bucket)
	assert.Equal(t, presign.ObjectKey, key)
}

// Bad image input never attaches.
func TestHandler_Image_RejectsBadInput(t *testing.T) {
	srv := mountedSrv(t, testutil.Pool(t))
	it := createItem(t, items.CreateItemRequest{Name: uniqueItemName("IMAGE BAD")})
	base := "/items/" + itoa(it.ID)
	cases := []struct {
		name   string
		method string
		path   string
		body   any
		want   int
	}{
		{"upload pdf", http.MethodGet, base + "/image/upload-url?fileName=spec.pdf", nil, http.StatusUnprocessableEntity},
		{"upload no name", http.MethodGet, base + "/image/upload-url", nil, http.StatusUnprocessableEntity},
		{"attach another item's key", http.MethodPatch, base + "/image",
			items.UpdateImageRequest{ObjectKey: "items/" + itoa(it.ID+1) + "/a.jpg"}, http.StatusUnprocessableEntity},
		{"attach a vendor key", http.MethodPatch, base + "/image",
			items.UpdateImageRequest{ObjectKey: "vendors/1/a.jpg"}, http.StatusUnprocessableEntity},
		{"missing item upload", http.MethodGet, "/items/999999999/image/upload-url?fileName=a.jpg", nil, http.StatusNotFound},
		{"missing item download", http.MethodGet, "/items/999999999/image/download-url", nil, http.StatusNotFound},
		{"missing item attach", http.MethodPatch, "/items/999999999/image",
			items.UpdateImageRequest{ObjectKey: "items/999999999/a.jpg"}, http.StatusNotFound},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := doJSON(t, srv, c.method, c.path, c.body)
			defer res.Body.Close()
			assert.Equal(t, c.want, res.StatusCode)
		})
	}

	got := doJSON(t, srv, http.MethodGet, base, nil)
	defer got.Body.Close()
	var item items.Item
	require.NoError(t, json.NewDecoder(got.Body).Decode(&item))
	assert.Nil(t, item.ImageObjectKey, "a refused key is never stored")
}

// No row means not found.
func TestRepo_UpdateImage_MissingItem(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	err := items.NewRepo(tx, testutil.Store(t)).UpdateImage(ctx, 999999999, "items/999999999/a.jpg", seedUserID)
	assert.ErrorIs(t, err, items.ErrNotFound)
}
