package httperr

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestError_Error(t *testing.T) {
	e := Error{Title: "Bad Request", Detail: "x missing"}
	assert.Equal(t, "Bad Request: x missing", e.Error())
}

func TestRender(t *testing.T) {
	rec := httptest.NewRecorder()
	Render(rec, BadRequest("nope"))
	res := rec.Result()
	defer res.Body.Close()

	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
	assert.Equal(t, "application/problem+json", res.Header.Get("Content-Type"))

	var body Error
	require.NoError(t, json.NewDecoder(res.Body).Decode(&body))
	assert.Equal(t, "Bad Request", body.Title)
	assert.Equal(t, "nope", body.Detail)
}

func TestFactories(t *testing.T) {
	cases := []struct {
		name   string
		got    Error
		status int
		title  string
	}{
		{"BadRequest", BadRequest("a"), http.StatusBadRequest, "Bad Request"},
		{"Unauthorized", Unauthorized("b"), http.StatusUnauthorized, "Unauthorized"},
		{"Forbidden", Forbidden("c"), http.StatusForbidden, "Forbidden"},
		{"NotFound", NotFound("d"), http.StatusNotFound, "Not Found"},
		{"Conflict", Conflict("e"), http.StatusConflict, "Conflict"},
		{"Internal", Internal("f"), http.StatusInternalServerError, "Internal Server Error"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.status, tc.got.Status)
			assert.Equal(t, tc.title, tc.got.Title)
			assert.Equal(t, "about:blank", tc.got.Type)
		})
	}
}

func TestUnprocessable(t *testing.T) {
	e := Unprocessable(map[string]string{"field": "msg"})
	assert.Equal(t, http.StatusUnprocessableEntity, e.Status)
	assert.Equal(t, "Unprocessable Entity", e.Title)
	assert.Equal(t, "msg", e.Fields["field"])
}

func TestFromDBErr_SQLSTATE(t *testing.T) {
	cases := []struct {
		code   string
		status int
	}{
		{"P0001", http.StatusUnprocessableEntity},
		{"23503", http.StatusNotFound},
		{"23505", http.StatusConflict},
		{"23502", http.StatusUnprocessableEntity},
		{"23514", http.StatusUnprocessableEntity},
		{"22P02", http.StatusUnprocessableEntity},
		{"22003", http.StatusUnprocessableEntity},
	}
	for _, tc := range cases {
		t.Run(tc.code, func(t *testing.T) {
			pgErr := &pgconn.PgError{Code: tc.code, Message: "x"}
			got := FromDBErr(pgErr)
			assert.Equal(t, tc.status, got.Status)
		})
	}
}

func TestFromDBErr_Fallback(t *testing.T) {
	got := FromDBErr(errors.New("plain"))
	assert.Equal(t, http.StatusInternalServerError, got.Status)
	assert.Equal(t, "plain", got.Detail)
}

func TestFromDBErr_UnknownPgCode(t *testing.T) {
	pgErr := &pgconn.PgError{Code: "99999", Message: "x"}
	got := FromDBErr(pgErr)
	assert.Equal(t, http.StatusInternalServerError, got.Status)
}

func TestRenderDBErr(t *testing.T) {
	rec := httptest.NewRecorder()
	RenderDBErr(rec, &pgconn.PgError{Code: "23505", Message: "dup"})
	res := rec.Result()
	defer res.Body.Close()
	assert.Equal(t, http.StatusConflict, res.StatusCode)
}
