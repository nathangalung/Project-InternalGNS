package app

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Client IP trusts only the proxy.
// Earlier X-Forwarded-For entries come from the client, and a public peer is
// not Traefik, so trusting either would let anyone dodge the login limit by
// inventing an address.
func TestClientIP(t *testing.T) {
	const traefik = "10.0.1.5:40000"
	cases := []struct {
		name   string
		peer   string
		xff    []string
		header [2]string
		want   string
	}{
		{name: "proxied single hop", peer: traefik, xff: []string{"203.0.113.7"}, want: "203.0.113.7"},
		{name: "proxied spoofed entries ignored", peer: traefik, xff: []string{"1.1.1.1, 2.2.2.2, 203.0.113.7"}, want: "203.0.113.7"},
		{name: "proxied duplicate headers merge", peer: traefik, xff: []string{"1.1.1.1", "203.0.113.7"}, want: "203.0.113.7"},
		{name: "proxied spaces trimmed", peer: traefik, xff: []string{"1.1.1.1 ,  203.0.113.7  "}, want: "203.0.113.7"},
		{name: "proxied v4-mapped folds", peer: traefik, xff: []string{"::ffff:203.0.113.7"}, want: "203.0.113.7"},
		{name: "loopback peer is trusted", peer: "127.0.0.1:5555", xff: []string{"203.0.113.7"}, want: "203.0.113.7"},
		{name: "v4-mapped private peer is trusted", peer: "[::ffff:172.18.0.3]:80", xff: []string{"203.0.113.7"}, want: "203.0.113.7"},
		{name: "proxied without header keeps the peer", peer: traefik, want: "10.0.1.5"},
		// chi skips empty entries; Traefik always appends a non-empty client.
		{name: "proxied empty entries skipped", peer: traefik, xff: []string{"203.0.113.7, , "}, want: "203.0.113.7"},
		{name: "proxied blank header keeps the peer", peer: traefik, xff: []string{" , "}, want: "10.0.1.5"},
		{name: "proxied garbage last hop keeps the peer", peer: traefik, xff: []string{"1.1.1.1, not-an-ip"}, want: "10.0.1.5"},
		{name: "public peer ignores forwarded for", peer: "198.51.100.9:1234", xff: []string{"203.0.113.7"}, want: "198.51.100.9"},
		{name: "public peer ignores real ip", peer: "198.51.100.9:1234", header: [2]string{"X-Real-IP", "203.0.113.7"}, want: "198.51.100.9"},
		{name: "proxied real ip ignored", peer: traefik, header: [2]string{"True-Client-IP", "203.0.113.7"}, want: "10.0.1.5"},
		{name: "port-less public peer", peer: "198.51.100.9", xff: []string{"203.0.113.7"}, want: "198.51.100.9"},
		{name: "unparseable peer sets nothing", peer: "pipe", xff: []string{"203.0.113.7"}, want: ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := "unset"
			h := clientIP(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
				got = middleware.GetClientIP(r.Context())
			}))
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.RemoteAddr = c.peer
			for _, v := range c.xff {
				req.Header.Add("X-Forwarded-For", v)
			}
			if c.header[0] != "" {
				req.Header.Set(c.header[0], c.header[1])
			}
			h.ServeHTTP(httptest.NewRecorder(), req)
			assert.Equal(t, c.want, got)
			assert.Equal(t, c.peer, req.RemoteAddr, "RemoteAddr must stay the TCP peer")
		})
	}
}

// Records levels and messages.
type levelCapture struct {
	levels []slog.Level
	msgs   []string
}

func (c *levelCapture) Enabled(context.Context, slog.Level) bool { return true }
func (c *levelCapture) WithAttrs([]slog.Attr) slog.Handler       { return c }
func (c *levelCapture) WithGroup(string) slog.Handler            { return c }
func (c *levelCapture) Handle(_ context.Context, r slog.Record) error {
	c.levels = append(c.levels, r.Level)
	c.msgs = append(c.msgs, r.Message)
	return nil
}

// Access log level follows status.
// Only a real server fault is an ERROR: a 503 is backpressure and a 4xx is
// the caller's, so neither may page the 5xx alert.
func TestAccessLog_LevelByStatus(t *testing.T) {
	cases := []struct {
		name   string
		path   string
		status int
		want   []slog.Level
	}{
		{"success", "/api/v1/units", http.StatusOK, []slog.Level{slog.LevelInfo}},
		{"client error", "/api/v1/units", http.StatusNotFound, []slog.Level{slog.LevelWarn}},
		{"server fault", "/api/v1/units", http.StatusInternalServerError, []slog.Level{slog.LevelError}},
		{"backpressure", "/api/v1/units", http.StatusServiceUnavailable, []slog.Level{slog.LevelWarn}},
		{"liveness probe unlogged", "/healthz", http.StatusOK, nil},
		{"readiness probe unlogged", "/readyz", http.StatusServiceUnavailable, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := &levelCapture{}
			prev := slog.Default()
			slog.SetDefault(slog.New(rec))
			t.Cleanup(func() { slog.SetDefault(prev) })

			h := accessLogMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(c.status)
			}))
			h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, c.path, nil))
			assert.Equal(t, c.want, rec.levels)
		})
	}
}

// JSON bodies are capped.
// Reads are never wrapped, since they carry no body worth limiting.
func TestBodyLimit(t *testing.T) {
	const limit = 16
	cases := []struct {
		name     string
		method   string
		path     string
		size     int
		wantRead int
		wantErr  bool
	}{
		{"write under the cap", http.MethodPost, "/api/v1/clients/", limit, limit, false},
		{"write past the cap", http.MethodPost, "/api/v1/clients/", limit + 1, limit, true},
		{"put past the cap", http.MethodPut, "/api/v1/items/1", limit * 2, limit, true},
		{"asset upload bypasses the cap", http.MethodPut, "/api/v1/storage/object", limit * 4, limit * 4, false},
		{"read is not wrapped", http.MethodGet, "/api/v1/clients/", limit * 2, limit * 2, false},
		{"delete is not wrapped", http.MethodDelete, "/api/v1/purchase-orders/1/file", limit * 2, limit * 2, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var read int
			var readErr error
			h := bodyLimitMiddleware(limit)(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
				b, err := io.ReadAll(r.Body)
				read, readErr = len(b), err
			}))
			req := httptest.NewRequest(c.method, c.path, bytes.NewReader(bytes.Repeat([]byte{'a'}, c.size)))
			h.ServeHTTP(httptest.NewRecorder(), req)

			assert.Equal(t, c.wantRead, read)
			if !c.wantErr {
				assert.NoError(t, readErr)
				return
			}
			var tooLarge *http.MaxBytesError
			require.True(t, errors.As(readErr, &tooLarge), "want MaxBytesError, got %v", readErr)
			assert.EqualValues(t, limit, tooLarge.Limit)
		})
	}
}

// Readiness needs the database.
// An orchestrator stops routing to an instance whose Postgres is gone.
func TestRouter_ReadyzWithoutDatabase(t *testing.T) {
	r := NewRouter(Config{JWTSecret: "readyz-down-secret"}, nil, testutil.Store(t), nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
	assert.JSONEq(t, `{"status":"unavailable"}`, rec.Body.String())

	// Liveness does not depend on the database.
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.True(t, strings.Contains(rec.Body.String(), `"ok"`))
}
