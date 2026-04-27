package items_test

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

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

func newSrv(t *testing.T) *httptest.Server {
	t.Helper()
	return testutil.ItemsServer(t, seedUserID)
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
	res := doJSON(t, srv, http.MethodGet, "/items/", nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var rows []items.Item
	require.NoError(t, json.NewDecoder(res.Body).Decode(&rows))
	assert.NotEmpty(t, rows)
}

func TestHandler_Get(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/1", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_Get_BadID(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/abc", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Get_NotFound(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/9999999", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusNotFound, res.StatusCode)
}

func TestHandler_Create_HappyPath(t *testing.T) {
	srv := newSrv(t)
	body := items.CreateItemRequest{Name: "API ITEM TEST"}
	res := doJSON(t, srv, http.MethodPost, "/items/", body)
	defer res.Body.Close()
	require.Equal(t, http.StatusCreated, res.StatusCode)
}

func TestHandler_Create_BadJSON(t *testing.T) {
	srv := newSrv(t)
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/items/", strings.NewReader("?"))
	req.Header.Set("Content-Type", "application/json")
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Create_EmptyName(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPost, "/items/", items.CreateItemRequest{})
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func TestHandler_Search(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/search?q=PUNCHING&minScore=0.05&limit=5", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_Search_MissingQ(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/search", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Search_BadParams(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/search?q=PUNCHING&minScore=junk&limit=zero", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_MatchRequest(t *testing.T) {
	srv := newSrv(t)
	body := items.MatchRequest{ReqText: "PUNCHING TOOL", Limit: 5}
	res := doJSON(t, srv, http.MethodPost, "/items/match-request", body)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_MatchRequest_BadJSON(t *testing.T) {
	srv := newSrv(t)
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/items/match-request", strings.NewReader("?"))
	req.Header.Set("Content-Type", "application/json")
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_MatchRequest_EmptyReqText(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPost, "/items/match-request", items.MatchRequest{})
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func TestHandler_MatchRequest_DefaultLimit(t *testing.T) {
	srv := newSrv(t)
	body := items.MatchRequest{ReqText: "ITEM"}
	res := doJSON(t, srv, http.MethodPost, "/items/match-request", body)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_ListVendorsForItem(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/1/vendors", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_ListVendorsForItem_BadID(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/abc/vendors", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_PriceHistory(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/1/price-history?limit=3", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_PriceHistory_BadID(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/abc/price-history", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_PriceHistory_DefaultLimit(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/1/price-history", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_PriceHistory_BadLimitFallback(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/1/price-history?limit=junk", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}
