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
	// Fields drive the form; Detail is what the toast reads. It carries the
	// field messages, never the field names.
	assert.Equal(t, "msg", e.Detail)
}

// Detail must keep each field's message, not flatten them to one sentence.
func TestUnprocessable_DetailKeepsFieldMessages(t *testing.T) {
	e := Unprocessable(map[string]string{
		"email":    "Email wajib diisi.",
		"password": "Kata sandi wajib diisi.",
	})
	// Sorted by field name so the message never depends on map order.
	assert.Equal(t, "Email wajib diisi.; Kata sandi wajib diisi.", e.Detail)
	assert.NotContains(t, e.Detail, "email")
	assert.NotContains(t, e.Detail, "password")
}

func TestUnprocessable_DetailIsStableAcrossRuns(t *testing.T) {
	fields := map[string]string{"a": "satu", "b": "dua", "c": "tiga", "d": "empat"}
	want := Unprocessable(fields).Detail
	for range 50 {
		assert.Equal(t, want, Unprocessable(fields).Detail)
	}
}

// A field with no usable message still needs prose for the toast.
func TestUnprocessable_BlankFieldsFallBackToGenericProse(t *testing.T) {
	assert.Equal(t, genericInvalidPayload, Unprocessable(nil).Detail)
	assert.Equal(t, genericInvalidPayload, Unprocessable(map[string]string{}).Detail)
	assert.Equal(t, genericInvalidPayload, Unprocessable(map[string]string{"name": "  "}).Detail)
}

func TestUnprocessableDetail(t *testing.T) {
	e := UnprocessableDetail("kenapa gagal", map[string]string{"name": "required"})
	assert.Equal(t, http.StatusUnprocessableEntity, e.Status)
	assert.Equal(t, "kenapa gagal", e.Detail)
	assert.Equal(t, "required", e.Fields["name"])
}

// Every 422 must carry prose; none may lean on a synthetic field key.
func TestUnprocessable_AlwaysHasDetail(t *testing.T) {
	codes := []string{"P0001", "P0012", "P0014", "23502", "23514", "22P02", "22003"}
	for _, code := range codes {
		t.Run(code, func(t *testing.T) {
			got := FromDBErr(&pgconn.PgError{Code: code, Message: "raised message"})
			require.Equal(t, http.StatusUnprocessableEntity, got.Status)
			assert.NotEmpty(t, got.Detail)
			assert.NotContains(t, got.Fields, "db")
			assert.NotContains(t, got.Fields, "field")
		})
	}
}

func TestFromDBErr_SQLSTATE(t *testing.T) {
	cases := []struct {
		code   string
		status int
	}{
		{"P0001", http.StatusUnprocessableEntity},
		{"P0011", http.StatusNotFound},
		{"P0012", http.StatusUnprocessableEntity},
		{"P0013", http.StatusConflict},
		{"P0014", http.StatusUnprocessableEntity},
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

// Business-rule raises must keep their message; only opaque codes are curated.
func TestFromDBErr_BusinessCodesKeepMessage(t *testing.T) {
	got := FromDBErr(&pgconn.PgError{Code: "P0014", Message: "discount_pct must be between 0 and 100"})
	assert.Equal(t, "discount_pct must be between 0 and 100", got.Detail)

	got = FromDBErr(&pgconn.PgError{Code: "P0013", Message: "PO 7 has an invoice; cannot revert from DELIVERED"})
	assert.Equal(t, "PO 7 has an invoice; cannot revert from DELIVERED", got.Detail)
}

func TestFromDBErr_Fallback(t *testing.T) {
	got := FromDBErr(errors.New("plain"))
	assert.Equal(t, http.StatusInternalServerError, got.Status)
	// Raw error text must never reach the client.
	assert.Equal(t, "internal server error", got.Detail)
	assert.NotContains(t, got.Detail, "plain")
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
