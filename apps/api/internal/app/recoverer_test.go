package app

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Panics log as JSON.
// chi's Recoverer printed a coloured stack to stderr with no request_id and
// answered a bare 500; the log pipeline could not join it to its request.
func TestRecoverer_LogsAndRendersProblem(t *testing.T) {
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(NewLogger(&buf, slog.LevelInfo))
	t.Cleanup(func() { slog.SetDefault(prev) })

	h := middleware.RequestID(recoverer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	})))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/quotations/1", nil)
	req.Header.Set(middleware.RequestIDHeader, "req-panic-1")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusInternalServerError, rec.Code)
	assert.Equal(t, "application/problem+json", rec.Header().Get("Content-Type"))
	var p struct {
		Status int    `json:"status"`
		Detail string `json:"detail"`
	}
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&p))
	assert.Equal(t, http.StatusInternalServerError, p.Status)

	var line struct {
		Level     string `json:"level"`
		Msg       string `json:"msg"`
		Panic     string `json:"panic"`
		Stack     string `json:"stack"`
		RequestID string `json:"request_id"`
	}
	require.NoError(t, json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &line), buf.String())
	assert.Equal(t, "ERROR", line.Level)
	assert.Equal(t, "panic", line.Msg)
	assert.Equal(t, "boom", line.Panic)
	assert.Contains(t, line.Stack, "recoverer_test.go")
	assert.Equal(t, "req-panic-1", line.RequestID)
}

// An aborted handler keeps aborting.
// net/http uses http.ErrAbortHandler to drop a connection on purpose.
func TestRecoverer_RepanicsAbort(t *testing.T) {
	h := recoverer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic(http.ErrAbortHandler)
	}))
	assert.PanicsWithValue(t, http.ErrAbortHandler, func() {
		h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
	})
}
