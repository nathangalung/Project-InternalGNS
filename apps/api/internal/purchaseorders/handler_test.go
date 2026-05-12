package purchaseorders_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

func newSrv(t *testing.T) *httptest.Server {
	t.Helper()
	return testutil.PurchaseOrdersServer(t, seedUserID)
}

func doJSON(t *testing.T, srv *httptest.Server, method, path string, body any) *http.Response {
	t.Helper()
	return doJSONWithHeaders(t, srv, method, path, body, nil)
}

func doJSONWithHeaders(
	t *testing.T, srv *httptest.Server, method, path string,
	body any, headers map[string]string,
) *http.Response {
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
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	return res
}

func TestHandler_List_OK(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/purchase-orders/", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)

	var rows []purchaseorders.PurchaseOrder
	require.NoError(t, json.NewDecoder(res.Body).Decode(&rows))
}

func TestHandler_List_StatusFilter(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/purchase-orders/?status=PENDING&limit=10", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_Get_BadID(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/purchase-orders/abc", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Get_NotFound(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/purchase-orders/99999999", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusNotFound, res.StatusCode)
}

func TestHandler_GetByQuotation_BadID(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/purchase-orders/by-quotation/abc", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_GetByQuotation_NotFound(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/purchase-orders/by-quotation/99999999", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusNotFound, res.StatusCode)
}

func TestHandler_ChangeStatus_BadID(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPatch, "/purchase-orders/abc/status",
		purchaseorders.ChangeStatusRequest{Status: purchaseorders.StatusUploaded})
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_ChangeStatus_BadJSON(t *testing.T) {
	srv := newSrv(t)
	req, err := http.NewRequest(http.MethodPatch, srv.URL+"/purchase-orders/1/status",
		bytes.NewReader([]byte("not-json")))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_ChangeStatus_InvalidStatus(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPatch, "/purchase-orders/1/status",
		purchaseorders.ChangeStatusRequest{Status: "INVALID"})
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func TestHandler_UpdateFile_BadID(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPatch, "/purchase-orders/abc/file",
		purchaseorders.UpdateFileRequest{FileName: "x.pdf", FileSize: 1, ObjectKey: "x"})
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_UpdateFile_NotFound(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPatch, "/purchase-orders/99999999/file",
		purchaseorders.UpdateFileRequest{FileName: "x.pdf", FileSize: 1, ObjectKey: "x"})
	defer res.Body.Close()
	assert.Equal(t, http.StatusNotFound, res.StatusCode)
}

func TestHandler_UpdateNotes_BadID(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPatch, "/purchase-orders/abc/notes",
		purchaseorders.UpdateNotesRequest{Notes: "x"})
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_UpdateNotes_NotFound(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPatch, "/purchase-orders/99999999/notes",
		purchaseorders.UpdateNotesRequest{Notes: "x"})
	defer res.Body.Close()
	assert.Equal(t, http.StatusNotFound, res.StatusCode)
}

func TestHandler_ListItems_BadID(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/purchase-orders/abc/items", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_ListItems_Empty(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/purchase-orders/99999999/items", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_ChangeStatus_NotFound(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPatch, "/purchase-orders/99999999/status",
		purchaseorders.ChangeStatusRequest{Status: purchaseorders.StatusUploaded})
	defer res.Body.Close()
	assert.Equal(t, http.StatusNotFound, res.StatusCode)
}

func TestHandler_List_GarbagePagination(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/purchase-orders/?limit=abc&offset=xyz&q=foo", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_List_ClampsLimits(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/purchase-orders/?limit=99999&offset=-5", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_UpdateFile_BadJSON(t *testing.T) {
	srv := newSrv(t)
	req, err := http.NewRequest(http.MethodPatch, srv.URL+"/purchase-orders/1/file",
		bytes.NewReader([]byte("not-json")))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_UpdateNotes_BadJSON(t *testing.T) {
	srv := newSrv(t)
	req, err := http.NewRequest(http.MethodPatch, srv.URL+"/purchase-orders/1/notes",
		bytes.NewReader([]byte("not-json")))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_UpdateItems_BadID(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPut, "/purchase-orders/abc/items",
		purchaseorders.UpdateItemsRequest{DiscountPct: "0", Items: []purchaseorders.UpdateItemsLine{}})
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_UpdateItems_BadJSON(t *testing.T) {
	srv := newSrv(t)
	req, err := http.NewRequest(http.MethodPut, srv.URL+"/purchase-orders/1/items",
		bytes.NewReader([]byte("not-json")))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("If-Match", "0")
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_UpdateItems_MissingIfMatch(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPut, "/purchase-orders/1/items",
		purchaseorders.UpdateItemsRequest{DiscountPct: "0", Items: []purchaseorders.UpdateItemsLine{}})
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_UpdateItems_MissingDiscount(t *testing.T) {
	srv := newSrv(t)
	res := doJSONWithHeaders(t, srv, http.MethodPut, "/purchase-orders/1/items",
		purchaseorders.UpdateItemsRequest{Items: []purchaseorders.UpdateItemsLine{}},
		map[string]string{"If-Match": "0"})
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func TestHandler_UpdateItems_NotFound(t *testing.T) {
	srv := newSrv(t)
	res := doJSONWithHeaders(t, srv, http.MethodPut, "/purchase-orders/99999999/items",
		purchaseorders.UpdateItemsRequest{DiscountPct: "0", Items: []purchaseorders.UpdateItemsLine{}},
		map[string]string{"If-Match": "0"})
	defer res.Body.Close()
	assert.Equal(t, http.StatusNotFound, res.StatusCode)
}
