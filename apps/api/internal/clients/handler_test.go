package clients_test

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

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

func newSrv(t *testing.T) *httptest.Server {
	t.Helper()
	return testutil.ClientsServer(t, seedUserID)
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
	res := doJSON(t, srv, http.MethodGet, "/clients/", nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	assert.NotEmpty(t, res.Header.Get("X-Total-Count"))
	var rows []clients.Client
	require.NoError(t, json.NewDecoder(res.Body).Decode(&rows))
	assert.NotEmpty(t, rows)
}

func TestHandler_List_FilterAndSort(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/clients/?q=IMC&sortBy=createdAt&sortDir=desc&limit=10", nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	assert.NotEmpty(t, res.Header.Get("X-Total-Count"))
	var rows []clients.Client
	require.NoError(t, json.NewDecoder(res.Body).Decode(&rows))
	assert.LessOrEqual(t, len(rows), 10)
}

func TestHandler_List_FilterInactive(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/clients/?isActive=false", nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var rows []clients.Client
	require.NoError(t, json.NewDecoder(res.Body).Decode(&rows))
	for _, c := range rows {
		assert.False(t, c.IsActive)
	}
}

func TestHandler_Get(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/clients/1", nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var c clients.Client
	require.NoError(t, json.NewDecoder(res.Body).Decode(&c))
	assert.Equal(t, int64(1), c.ID)
}

func TestHandler_Get_BadID(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/clients/abc", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Get_NotFound(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/clients/999999", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusNotFound, res.StatusCode)
}

func TestHandler_Create_HappyPath(t *testing.T) {
	srv := newSrv(t)
	body := clients.CreateClientRequest{
		Name:        "PT Handler Anyar",
		Number:      ptr("X1"),
		CountryCode: "IDN",
	}
	res := doJSON(t, srv, http.MethodPost, "/clients/", body)
	defer res.Body.Close()
	require.Equal(t, http.StatusCreated, res.StatusCode)
	var c clients.Client
	require.NoError(t, json.NewDecoder(res.Body).Decode(&c))
	assert.Equal(t, "PT Handler Anyar", c.Name)
}

func TestHandler_Create_BadJSON(t *testing.T) {
	srv := newSrv(t)
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/clients/", strings.NewReader("?"))
	req.Header.Set("Content-Type", "application/json")
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Create_EmptyName(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPost, "/clients/", clients.CreateClientRequest{})
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func TestHandler_Search(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/clients/search?q=IMC&minScore=0.1&limit=5", nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var hits []clients.SearchResult
	require.NoError(t, json.NewDecoder(res.Body).Decode(&hits))
	assert.NotEmpty(t, hits)
}

func TestHandler_Search_MissingQ(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/clients/search", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Search_BadParams(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/clients/search?q=IMC&minScore=junk&limit=zero", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_ListContacts(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/clients/1/contacts", nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var rows []clients.Contact
	require.NoError(t, json.NewDecoder(res.Body).Decode(&rows))
	assert.NotEmpty(t, rows)
}

func TestHandler_ListContacts_BadID(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/clients/abc/contacts", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_CreateContact(t *testing.T) {
	srv := newSrv(t)
	body := clients.CreateContactRequest{
		Name:        "API Contact",
		Phone:       ptr("081111222333"),
		CountryCode: "IDN",
	}
	res := doJSON(t, srv, http.MethodPost, "/clients/1/contacts", body)
	defer res.Body.Close()
	require.Equal(t, http.StatusCreated, res.StatusCode)
	var c clients.Contact
	require.NoError(t, json.NewDecoder(res.Body).Decode(&c))
	assert.Equal(t, "API Contact", c.Name)
}

func TestHandler_CreateContact_BadID(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPost, "/clients/abc/contacts", clients.CreateContactRequest{Name: "x"})
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_CreateContact_BadJSON(t *testing.T) {
	srv := newSrv(t)
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/clients/1/contacts", strings.NewReader("?"))
	req.Header.Set("Content-Type", "application/json")
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_CreateContact_EmptyName(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPost, "/clients/1/contacts", clients.CreateContactRequest{})
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func TestHandler_CreateContact_PhoneCheckViolation(t *testing.T) {
	srv := newSrv(t)
	body := clients.CreateContactRequest{
		Name:        "Bad Phone",
		Phone:       ptr("123"),
		CountryCode: "IDN",
	}
	res := doJSON(t, srv, http.MethodPost, "/clients/1/contacts", body)
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func TestHandler_Update_BadID(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPut, "/clients/abc",
		clients.UpdateClientRequest{Name: "X", CountryCode: "IDN"})
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Update_BadJSON(t *testing.T) {
	srv := newSrv(t)
	req, err := http.NewRequest(http.MethodPut, srv.URL+"/clients/1", bytes.NewReader([]byte("not-json")))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Update_EmptyName(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPut, "/clients/1",
		clients.UpdateClientRequest{Name: "", CountryCode: "IDN"})
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func TestHandler_Update_NotFound(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPut, "/clients/99999999",
		clients.UpdateClientRequest{Name: "X", CountryCode: "IDN", IsActive: true})
	defer res.Body.Close()
	assert.Equal(t, http.StatusNotFound, res.StatusCode)
}

func TestHandler_Summary(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/clients/summary", nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var s clients.Summary
	require.NoError(t, json.NewDecoder(res.Body).Decode(&s))
	assert.GreaterOrEqual(t, s.Total, int64(1))
}

func TestHandler_PresignLogoUpload_StorageUnavailable(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/clients/1/logo/upload-url?fileName=x.png", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusServiceUnavailable, res.StatusCode)
}

func TestHandler_PresignLogoDownload_StorageUnavailable(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/clients/1/logo/download-url", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusServiceUnavailable, res.StatusCode)
}

func TestHandler_UpdateLogo_BadID(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPatch, "/clients/abc/logo",
		clients.UpdateLogoRequest{ObjectKey: "x"})
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_UpdateLogo_EmptyObjectKey(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPatch, "/clients/1/logo",
		clients.UpdateLogoRequest{ObjectKey: " "})
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func TestHandler_UpdateLogo_NotFound(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPatch, "/clients/99999999/logo",
		clients.UpdateLogoRequest{ObjectKey: "clients/1/x.png"})
	defer res.Body.Close()
	assert.Equal(t, http.StatusNotFound, res.StatusCode)
}
