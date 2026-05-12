package vendors_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/vendors"
)

func newSrv(t *testing.T) *httptest.Server {
	t.Helper()
	return testutil.VendorsServer(t, seedUserID)
}

func doJSON(t *testing.T, srv *httptest.Server, method, path string, body any) *http.Response {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		require.NoError(t, err)
		rdr = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, srv.URL+path, rdr)
	require.NoError(t, err)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	return res
}

func TestHandler_List(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/vendors/", nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var rows []vendors.Vendor
	require.NoError(t, json.NewDecoder(res.Body).Decode(&rows))
	assert.NotEmpty(t, rows)
}

func TestHandler_Get(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/vendors/1", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_Get_BadID(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/vendors/bad", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Get_NotFound(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/vendors/9999999", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusNotFound, res.StatusCode)
}

func TestHandler_Create_HappyPath(t *testing.T) {
	srv := newSrv(t)
	body := vendors.CreateVendorRequest{
		Name:     "Vendor Create Test",
		Location: ptr("Jakarta"),
	}
	res := doJSON(t, srv, http.MethodPost, "/vendors/", body)
	defer res.Body.Close()
	require.Equal(t, http.StatusCreated, res.StatusCode)
	var v vendors.Vendor
	require.NoError(t, json.NewDecoder(res.Body).Decode(&v))
	assert.Equal(t, "Vendor Create Test", v.Name)
}

func TestHandler_Create_BadJSON(t *testing.T) {
	srv := newSrv(t)
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/vendors/", strings.NewReader("?"))
	req.Header.Set("Content-Type", "application/json")
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Create_EmptyName(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPost, "/vendors/", vendors.CreateVendorRequest{})
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func TestHandler_Search(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/vendors/search?q=Toko&minScore=0.05&limit=5", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_Search_MissingQ(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/vendors/search", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Search_BadParams(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/vendors/search?q=Toko&minScore=junk&limit=zero", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_ListItems(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/vendors/1/items?limit=10", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_ListItems_BadID(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/vendors/bad/items", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_ListItems_DefaultLimit(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/vendors/1/items", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_ListItems_BadLimitFallback(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/vendors/1/items?limit=999", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_Update_BadID(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPut, "/vendors/abc",
		vendors.UpdateVendorRequest{Name: "X"})
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Update_BadJSON(t *testing.T) {
	srv := newSrv(t)
	req, err := http.NewRequest(http.MethodPut, srv.URL+"/vendors/1", bytes.NewReader([]byte("not-json")))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Update_EmptyName(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPut, "/vendors/1",
		vendors.UpdateVendorRequest{Name: ""})
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func TestHandler_Update_NotFound(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPut, "/vendors/99999999",
		vendors.UpdateVendorRequest{Name: "X", IsActive: true})
	defer res.Body.Close()
	assert.Equal(t, http.StatusNotFound, res.StatusCode)
}
