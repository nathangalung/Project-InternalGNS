package users_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

func newUsersServer(t *testing.T) *httptest.Server {
	t.Helper()
	return testutil.UsersServer(t, 1)
}

// Send JSON body.
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

// Send raw body.
func doRaw(t *testing.T, srv *httptest.Server, method, path, body string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	return res
}

func TestHandler_List_Defaults(t *testing.T) {
	srv := newUsersServer(t)
	res := doJSON(t, srv, http.MethodGet, "/users/", nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var rows []users.User
	require.NoError(t, json.NewDecoder(res.Body).Decode(&rows))
}

func TestHandler_List_WithFilters(t *testing.T) {
	srv := newUsersServer(t)
	res := doJSON(t, srv, http.MethodGet, "/users/?q=test&role=superadmin&limit=5&offset=0", nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_List_ClampsLimits(t *testing.T) {
	srv := newUsersServer(t)
	res := doJSON(t, srv, http.MethodGet, "/users/?limit=99999&offset=-5", nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_List_GarbagePagination(t *testing.T) {
	srv := newUsersServer(t)
	res := doJSON(t, srv, http.MethodGet, "/users/?limit=abc&offset=xyz", nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_Get_InvalidID(t *testing.T) {
	srv := newUsersServer(t)
	res := doJSON(t, srv, http.MethodGet, "/users/not-a-number", nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Get_NotFound(t *testing.T) {
	srv := newUsersServer(t)
	res := doJSON(t, srv, http.MethodGet, "/users/99999999", nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusNotFound, res.StatusCode)
}

func TestHandler_Get_Found(t *testing.T) {
	srv := newUsersServer(t)
	res := doJSON(t, srv, http.MethodGet, "/users/1", nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var u users.User
	require.NoError(t, json.NewDecoder(res.Body).Decode(&u))
	assert.Equal(t, int64(1), u.ID)
}

func TestHandler_Create_BadJSON(t *testing.T) {
	srv := newUsersServer(t)
	res := doRaw(t, srv, http.MethodPost, "/users/", "{not-json")
	defer res.Body.Close()
	require.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Create_ValidationErrors(t *testing.T) {
	srv := newUsersServer(t)
	res := doJSON(t, srv, http.MethodPost, "/users/", map[string]any{
		"email": "", "name": "", "password": "short", "role": "weird",
	})
	defer res.Body.Close()
	require.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func TestHandler_Create_DuplicateEmail(t *testing.T) {
	srv := newUsersServer(t)
	email := fmt.Sprintf("dup-%d@test.local", randSuffix())
	body := map[string]any{
		"email": email, "name": "Dup User", "password": "longenough", "role": "operational",
	}
	r1 := doJSON(t, srv, http.MethodPost, "/users/", body)
	r1.Body.Close()
	require.Equal(t, http.StatusCreated, r1.StatusCode)

	r2 := doJSON(t, srv, http.MethodPost, "/users/", body)
	defer r2.Body.Close()
	require.Equal(t, http.StatusConflict, r2.StatusCode)
}

func TestHandler_Update_InvalidID(t *testing.T) {
	srv := newUsersServer(t)
	res := doJSON(t, srv, http.MethodPut, "/users/not-a-number", map[string]any{
		"email": "a@b.c", "name": "X", "role": "operational", "isActive": true,
	})
	defer res.Body.Close()
	require.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Update_BadJSON(t *testing.T) {
	srv := newUsersServer(t)
	res := doRaw(t, srv, http.MethodPut, "/users/1", "{bad")
	defer res.Body.Close()
	require.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Update_ValidationErrors(t *testing.T) {
	srv := newUsersServer(t)
	res := doJSON(t, srv, http.MethodPut, "/users/1", map[string]any{
		"email": "", "name": "", "role": "nope",
	})
	defer res.Body.Close()
	require.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func TestHandler_Update_NotFound(t *testing.T) {
	srv := newUsersServer(t)
	res := doJSON(t, srv, http.MethodPut, "/users/99999999", map[string]any{
		"email": "x@y.z", "name": "X", "role": "operational", "isActive": true,
	})
	defer res.Body.Close()
	require.Equal(t, http.StatusNotFound, res.StatusCode)
}

func TestHandler_Update_OK(t *testing.T) {
	srv := newUsersServer(t)
	email := fmt.Sprintf("upd-%d@test.local", randSuffix())
	create := map[string]any{
		"email": email, "name": "Upd", "password": "longenough", "role": "operational",
	}
	cr := doJSON(t, srv, http.MethodPost, "/users/", create)
	require.Equal(t, http.StatusCreated, cr.StatusCode)
	var created users.User
	require.NoError(t, json.NewDecoder(cr.Body).Decode(&created))
	cr.Body.Close()

	upd := doJSON(t, srv, http.MethodPut, fmt.Sprintf("/users/%d", created.ID), map[string]any{
		"email": email, "name": "Upd Renamed", "role": "finance", "isActive": false,
	})
	defer upd.Body.Close()
	require.Equal(t, http.StatusOK, upd.StatusCode)
}

func TestHandler_ChangePassword_InvalidID(t *testing.T) {
	srv := newUsersServer(t)
	res := doJSON(t, srv, http.MethodPatch, "/users/abc/password", map[string]any{"password": "longenough"})
	defer res.Body.Close()
	require.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_ChangePassword_BadJSON(t *testing.T) {
	srv := newUsersServer(t)
	res := doRaw(t, srv, http.MethodPatch, "/users/1/password", "{nope")
	defer res.Body.Close()
	require.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_ChangePassword_TooShort(t *testing.T) {
	srv := newUsersServer(t)
	res := doJSON(t, srv, http.MethodPatch, "/users/1/password", map[string]any{"password": "abc"})
	defer res.Body.Close()
	require.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func TestHandler_ChangePassword_NotFound(t *testing.T) {
	srv := newUsersServer(t)
	res := doJSON(t, srv, http.MethodPatch, "/users/99999999/password", map[string]any{"password": "longenough"})
	defer res.Body.Close()
	require.Equal(t, http.StatusNotFound, res.StatusCode)
}

func TestHandler_ChangePassword_OK(t *testing.T) {
	srv := newUsersServer(t)
	email := fmt.Sprintf("pwd-%d@test.local", randSuffix())
	cr := doJSON(t, srv, http.MethodPost, "/users/", map[string]any{
		"email": email, "name": "Pwd", "password": "originalpwd", "role": "operational",
	})
	require.Equal(t, http.StatusCreated, cr.StatusCode)
	var created users.User
	require.NoError(t, json.NewDecoder(cr.Body).Decode(&created))
	cr.Body.Close()

	res := doJSON(t, srv, http.MethodPatch, fmt.Sprintf("/users/%d/password", created.ID),
		map[string]any{"password": "newpassword"})
	defer res.Body.Close()
	require.Equal(t, http.StatusNoContent, res.StatusCode)
}

var suffixCounter atomic.Int64

// Unique across runs.
func randSuffix() int64 {
	return time.Now().UnixNano() + suffixCounter.Add(1)
}
