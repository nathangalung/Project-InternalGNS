package items_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

// uploadKey presigns one photo.
func uploadKey(t *testing.T, srv *httptest.Server, base, name string) string {
	t.Helper()
	res := doJSON(t, srv, http.MethodGet, base+"/image/upload-url?fileName="+name, nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var presign struct {
		UploadURL string `json:"uploadUrl"`
		ObjectKey string `json:"objectKey"`
	}
	require.NoError(t, json.NewDecoder(res.Body).Decode(&presign))
	bucket, key := proxyKey(t, presign.UploadURL)
	assert.Equal(t, storage.BucketItemImages, bucket)
	assert.Equal(t, presign.ObjectKey, key)
	return presign.ObjectKey
}

// gallery reads the photo list.
func gallery(t *testing.T, srv *httptest.Server, base string) items.ItemGallery {
	t.Helper()
	res := doJSON(t, srv, http.MethodGet, base+"/images", nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var g items.ItemGallery
	require.NoError(t, json.NewDecoder(res.Body).Decode(&g))
	return g
}

// cover reads the item's cover key.
func cover(t *testing.T, srv *httptest.Server, base string) *string {
	t.Helper()
	res := doJSON(t, srv, http.MethodGet, base, nil)
	defer res.Body.Close()
	var item items.Item
	require.NoError(t, json.NewDecoder(res.Body).Decode(&item))
	return item.ImageObjectKey
}

// status sends one request for its code.
func status(t *testing.T, srv *httptest.Server, method, path string, body any) int {
	t.Helper()
	res := doJSON(t, srv, method, path, body)
	defer res.Body.Close()
	return res.StatusCode
}

// Photos added, covered, removed.
// The first photo becomes the cover; Jadikan Utama moves it; removing the
// cover passes it to the oldest photo left, and the last removal clears it.
func TestHandler_Gallery_Flow(t *testing.T) {
	srv := mountedSrv(t, testutil.Pool(t))
	it := createItem(t, items.CreateItemRequest{Name: uniqueItemName("GALLERY")})
	base := "/items/" + itoa(it.ID)

	empty := gallery(t, srv, base)
	assert.Equal(t, items.MaxItemImages, empty.Max)
	assert.Empty(t, empty.Images)
	assert.Equal(t, http.StatusNotFound, status(t, srv, http.MethodGet, base+"/image/download-url", nil),
		"no cover yet")

	// Phone cameras repeat names; each upload still gets its own key.
	first := uploadKey(t, srv, base, "IMG_0001.jpg")
	second := uploadKey(t, srv, base, "IMG_0001.jpg")
	require.NotEqual(t, first, second)
	for _, k := range []string{first, second} {
		require.Equal(t, http.StatusNoContent,
			status(t, srv, http.MethodPost, base+"/images", items.UpdateImageRequest{ObjectKey: k}))
	}
	// A retried attach adds nothing.
	require.Equal(t, http.StatusNoContent,
		status(t, srv, http.MethodPost, base+"/images", items.UpdateImageRequest{ObjectKey: second}))

	g := gallery(t, srv, base)
	require.Len(t, g.Images, 2)
	assert.Equal(t, first, g.Images[0].ObjectKey, "the cover comes first")
	assert.True(t, g.Images[0].IsCover)
	assert.False(t, g.Images[1].IsCover)
	_, dlKey := proxyKey(t, g.Images[1].DownloadURL)
	assert.Equal(t, second, dlKey, "every photo carries its own download")
	require.NotNil(t, cover(t, srv, base))
	assert.Equal(t, first, *cover(t, srv, base))

	secondID := itoa(g.Images[1].ID)
	require.Equal(t, http.StatusNoContent, status(t, srv, http.MethodPut, base+"/images/"+secondID+"/cover", nil))
	g = gallery(t, srv, base)
	assert.Equal(t, second, g.Images[0].ObjectKey)
	assert.Equal(t, second, *cover(t, srv, base))

	require.Equal(t, http.StatusNoContent, status(t, srv, http.MethodDelete, base+"/images/"+secondID, nil))
	g = gallery(t, srv, base)
	require.Len(t, g.Images, 1)
	assert.Equal(t, first, *cover(t, srv, base), "the cover passes on")

	require.Equal(t, http.StatusNoContent, status(t, srv, http.MethodDelete, base+"/images/"+itoa(g.Images[0].ID), nil))
	assert.Empty(t, gallery(t, srv, base).Images)
	assert.Nil(t, cover(t, srv, base), "no photos, no cover")
}

// The gallery stops at its maximum.
func TestHandler_Gallery_Limit(t *testing.T) {
	srv := mountedSrv(t, testutil.Pool(t))
	it := createItem(t, items.CreateItemRequest{Name: uniqueItemName("GALLERY LIMIT")})
	base := "/items/" + itoa(it.ID)
	for i := 0; i < items.MaxItemImages; i++ {
		k := uploadKey(t, srv, base, "foto.webp")
		require.Equal(t, http.StatusNoContent,
			status(t, srv, http.MethodPost, base+"/images", items.UpdateImageRequest{ObjectKey: k}))
	}
	k := uploadKey(t, srv, base, "foto.webp")
	res := doJSON(t, srv, http.MethodPost, base+"/images", items.UpdateImageRequest{ObjectKey: k})
	defer res.Body.Close()
	require.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
	var p struct {
		Detail string `json:"detail"`
	}
	require.NoError(t, json.NewDecoder(res.Body).Decode(&p))
	assert.Equal(t, "Maksimal 8 foto per produk.", p.Detail)
	assert.Len(t, gallery(t, srv, base).Images, items.MaxItemImages)
}

// Bad gallery input changes nothing.
func TestHandler_Gallery_Refusals(t *testing.T) {
	srv := mountedSrv(t, testutil.Pool(t))
	it := createItem(t, items.CreateItemRequest{Name: uniqueItemName("GALLERY BAD")})
	other := createItem(t, items.CreateItemRequest{Name: uniqueItemName("GALLERY OTHER")})
	base := "/items/" + itoa(it.ID)
	otherBase := "/items/" + itoa(other.ID)
	k := uploadKey(t, srv, otherBase, "foto.png")
	require.Equal(t, http.StatusNoContent,
		status(t, srv, http.MethodPost, otherBase+"/images", items.UpdateImageRequest{ObjectKey: k}))
	foreign := itoa(gallery(t, srv, otherBase).Images[0].ID)

	cases := []struct {
		name   string
		method string
		path   string
		body   any
		want   int
	}{
		{"upload pdf", http.MethodGet, base + "/image/upload-url?fileName=spec.pdf", nil, http.StatusUnprocessableEntity},
		{"upload no name", http.MethodGet, base + "/image/upload-url", nil, http.StatusUnprocessableEntity},
		{"add another item's key", http.MethodPost, base + "/images",
			items.UpdateImageRequest{ObjectKey: k}, http.StatusUnprocessableEntity},
		{"add a vendor key", http.MethodPost, base + "/images",
			items.UpdateImageRequest{ObjectKey: "vendors/1/a.jpg"}, http.StatusUnprocessableEntity},
		{"delete another item's photo", http.MethodDelete, base + "/images/" + foreign, nil, http.StatusNotFound},
		{"cover another item's photo", http.MethodPut, base + "/images/" + foreign + "/cover", nil, http.StatusNotFound},
		{"delete bad id", http.MethodDelete, base + "/images/x", nil, http.StatusBadRequest},
		{"cover bad id", http.MethodPut, base + "/images/x/cover", nil, http.StatusBadRequest},
		{"list bad id", http.MethodGet, "/items/x/images", nil, http.StatusBadRequest},
		{"delete bad item", http.MethodDelete, "/items/x/images/1", nil, http.StatusBadRequest},
		{"missing item list", http.MethodGet, "/items/999999999/images", nil, http.StatusNotFound},
		{"missing item upload", http.MethodGet, "/items/999999999/image/upload-url?fileName=a.jpg", nil, http.StatusNotFound},
		{"missing item download", http.MethodGet, "/items/999999999/image/download-url", nil, http.StatusNotFound},
		{"missing item add", http.MethodPost, "/items/999999999/images",
			items.UpdateImageRequest{ObjectKey: "items/999999999/a.jpg"}, http.StatusNotFound},
		{"missing item delete", http.MethodDelete, "/items/999999999/images/" + foreign, nil, http.StatusNotFound},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			assert.Equal(t, c.want, status(t, srv, c.method, c.path, c.body))
		})
	}
	assert.Empty(t, gallery(t, srv, base).Images, "a refused photo is never stored")
	assert.Nil(t, cover(t, srv, base))
	assert.Len(t, gallery(t, srv, otherBase).Images, 1, "the other item keeps its photo")
}

// The list needs storage.
func TestHandler_Gallery_NoStorage(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/1/images", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusServiceUnavailable, res.StatusCode)
}

// No row means not found.
func TestRepo_AddImage_MissingItem(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, err := items.NewRepo(tx, testutil.Store(t)).AddImage(ctx, 999999999, "items/999999999/a.jpg", seedUserID)
	require.Error(t, err)
	assert.True(t, strings.Contains(err.Error(), "Produk tidak ditemukan"), err.Error())
}
