package httpx

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// problemDetail reads problem+json detail.
func problemDetail(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	assert.Equal(t, "application/problem+json", rec.Header().Get("Content-Type"))
	var body struct {
		Detail string `json:"detail"`
	}
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&body))
	return body.Detail
}

func TestPathID(t *testing.T) {
	cases := []struct {
		name   string
		raw    string
		msg    string
		wantID int64
		wantOK bool
	}{
		{"valid", "42", "invalid id", 42, true},
		{"not a number", "abc", "invalid id", 0, false},
		{"overflow", "99999999999999999999", "invalid id", 0, false},
		{"empty", "", "invalid id", 0, false},
		{"caller message kept", "x", "invalid contact id", 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			rctx := chi.NewRouteContext()
			rctx.URLParams.Add("contactId", tc.raw)
			req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
			rec := httptest.NewRecorder()

			id, ok := PathID(rec, req, "contactId", tc.msg)
			assert.Equal(t, tc.wantOK, ok)
			assert.Equal(t, tc.wantID, id)
			if !tc.wantOK {
				assert.Equal(t, http.StatusBadRequest, rec.Code)
				assert.Equal(t, tc.msg, problemDetail(t, rec))
			}
		})
	}
}

func TestDecodeJSON(t *testing.T) {
	type payload struct {
		Name string `json:"name"`
	}
	cases := []struct {
		name     string
		body     string
		wantOK   bool
		wantName string
	}{
		{"valid", `{"name":"Budi"}`, true, "Budi"},
		{"malformed", `{"name":`, false, ""},
		{"empty", ``, false, ""},
		{"wrong type", `{"name":7}`, false, ""},
		// v1 semantics on the v2 backend: the last duplicate wins and
		// invalid UTF-8 becomes U+FFFD. v2 defaults would reject both.
		{"duplicate key", `{"name":"Andi","name":"Budi"}`, true, "Budi"},
		{"invalid utf-8", "{\"name\":\"Bu\xffdi\"}", true, "Bu�di"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(tc.body))
			rec := httptest.NewRecorder()
			var got payload
			ok := DecodeJSON(rec, req, &got)
			assert.Equal(t, tc.wantOK, ok)
			assert.Equal(t, tc.wantName, got.Name)
			if !tc.wantOK {
				assert.Equal(t, http.StatusBadRequest, rec.Code)
				assert.Equal(t, "invalid json", problemDetail(t, rec))
			}
		})
	}
}

// An oversized body is a 413.
// The body limit middleware wraps every body in http.MaxBytesReader; its
// overflow is the caller's size, not malformed JSON.
func TestDecodeJSON_TooLarge(t *testing.T) {
	body := `{"name":"` + strings.Repeat("a", 64) + `"}`
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	rec := httptest.NewRecorder()
	req.Body = http.MaxBytesReader(rec, req.Body, 16)
	var got struct {
		Name string `json:"name"`
	}
	assert.False(t, DecodeJSON(rec, req, &got))
	assert.Equal(t, http.StatusRequestEntityTooLarge, rec.Code)
	assert.Equal(t, BodyTooLargeDetail, problemDetail(t, rec))
}

// Optional bodies may be empty.
func TestDecodeOptionalJSON(t *testing.T) {
	type payload struct {
		Name string `json:"name"`
	}
	cases := []struct {
		name     string
		body     io.Reader
		limit    int64
		wantOK   bool
		wantCode int
		wantName string
	}{
		{"valid", strings.NewReader(`{"name":"Budi"}`), 0, true, http.StatusOK, "Budi"},
		{"empty", strings.NewReader(""), 0, true, http.StatusOK, ""},
		{"no body", nil, 0, true, http.StatusOK, ""},
		{"malformed", strings.NewReader(`{"name":`), 0, false, http.StatusBadRequest, ""},
		{"too large", strings.NewReader(`{"name":"` + strings.Repeat("a", 64) + `"}`), 16, false, http.StatusRequestEntityTooLarge, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/", tc.body)
			rec := httptest.NewRecorder()
			if tc.body == nil {
				req.Body = nil
			}
			if tc.limit > 0 {
				req.Body = http.MaxBytesReader(rec, req.Body, tc.limit)
			}
			var got payload
			assert.Equal(t, tc.wantOK, DecodeOptionalJSON(rec, req, &got))
			assert.Equal(t, tc.wantCode, rec.Code)
			assert.Equal(t, tc.wantName, got.Name)
		})
	}
}

func TestWriteList(t *testing.T) {
	cases := []struct {
		name      string
		total     int64
		rows      any
		wantTotal string
		wantBody  string
	}{
		{"page of a larger set", 120, []int{1, 2}, "120", "[1,2]\n"},
		{"empty list", 0, []int{}, "0", "[]\n"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			WriteList(rec, tc.total, tc.rows)
			assert.Equal(t, http.StatusOK, rec.Code)
			assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))
			assert.Equal(t, tc.wantTotal, rec.Header().Get("X-Total-Count"))
			assert.Equal(t, tc.wantBody, rec.Body.String())
		})
	}
}
