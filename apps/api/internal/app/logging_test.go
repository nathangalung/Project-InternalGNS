package app

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Decodes one JSON line per record.
func logLines(t *testing.T, buf *bytes.Buffer) []map[string]any {
	t.Helper()
	var out []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		if line == "" {
			continue
		}
		var m map[string]any
		require.NoError(t, json.Unmarshal([]byte(line), &m), line)
		out = append(out, m)
	}
	return out
}

// Every record carries the request id.
// A handler's error line joins its access-log line by request_id, and that
// must survive a logger derived with attributes. A grouped logger still
// writes, though its stamp nests inside the group; nothing groups today.
func TestNewLogger_StampsRequestID(t *testing.T) {
	var buf bytes.Buffer
	logger := NewLogger(&buf, slog.LevelInfo)
	ctx := context.WithValue(context.Background(), middleware.RequestIDKey, "req-42")

	logger.InfoContext(ctx, "plain")
	logger.With("slice", "invoices").InfoContext(ctx, "with attrs")
	logger.WithGroup("export").InfoContext(ctx, "with group", "rows", 3)
	logger.InfoContext(context.Background(), "no request")
	logger.DebugContext(ctx, "below level")

	lines := logLines(t, &buf)
	require.Len(t, lines, 4, "the debug record must be dropped at info level")
	for _, l := range lines[:2] {
		assert.Equal(t, "req-42", l["request_id"], l["msg"])
	}
	assert.Equal(t, "invoices", lines[1]["slice"])
	group, ok := lines[2]["export"].(map[string]any)
	require.True(t, ok, "group missing: %v", lines[2])
	assert.EqualValues(t, 3, group["rows"])
	assert.NotContains(t, lines[3], "request_id", "no id, no stamp")
}

// The access log and the handler share one id.
func TestNewLogger_JoinsAccessLog(t *testing.T) {
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(NewLogger(&buf, slog.LevelInfo))
	t.Cleanup(func() { slog.SetDefault(prev) })

	h := middleware.RequestID(accessLogMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		slog.ErrorContext(r.Context(), "handler failed")
		w.WriteHeader(http.StatusInternalServerError)
	})))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/v1/x", nil))

	lines := logLines(t, &buf)
	require.Len(t, lines, 2)
	assert.Equal(t, "handler failed", lines[0]["msg"])
	assert.Equal(t, "http_request", lines[1]["msg"])
	assert.NotEmpty(t, lines[0]["request_id"])
	assert.Equal(t, lines[0]["request_id"], lines[1]["request_id"])
}

// LOG_LEVEL maps onto slog levels.
func TestConfig_SlogLevel(t *testing.T) {
	cases := []struct {
		in   string
		want slog.Level
	}{
		{"debug", slog.LevelDebug},
		{" DEBUG ", slog.LevelDebug},
		{"info", slog.LevelInfo},
		{"warn", slog.LevelWarn},
		{"warning", slog.LevelWarn},
		{"error", slog.LevelError},
		{"", slog.LevelInfo},
		{"verbose", slog.LevelInfo},
	}
	for _, c := range cases {
		assert.Equal(t, c.want, Config{LogLevel: c.in}.SlogLevel(), "LOG_LEVEL=%q", c.in)
	}
}
