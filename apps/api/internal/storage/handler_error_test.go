package storage

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// logCapture keeps records with context.
type logCapture struct {
	mu   sync.Mutex
	ctxs []context.Context
	msgs []string
}

func (c *logCapture) Enabled(context.Context, slog.Level) bool { return true }
func (c *logCapture) WithAttrs([]slog.Attr) slog.Handler       { return c }
func (c *logCapture) WithGroup(string) slog.Handler            { return c }
func (c *logCapture) Handle(ctx context.Context, r slog.Record) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	var b strings.Builder
	b.WriteString(r.Message)
	r.Attrs(func(a slog.Attr) bool {
		b.WriteString(" " + a.Key + "=" + a.Value.String())
		return true
	})
	c.ctxs = append(c.ctxs, ctx)
	c.msgs = append(c.msgs, b.String())
	return nil
}

// failingGetStore fails every GetObject.
type failingGetStore struct{ fakeStore }

func (failingGetStore) GetObject(context.Context, string, string) (io.ReadCloser, string, int64, error) {
	return nil, "", 0, errors.New("minio get exploded")
}

type probeKey struct{}

// Failures log cause, render problem.
// A proxy failure is a 5xx the operator has to act on, so it must log its
// cause under the request context, and answer as problem+json like every
// other API error.
func TestHandler_FailuresLogCauseAndRenderProblem(t *testing.T) {
	const url = "/storage/object?bucket=" + BucketItemImages + "&key=items/7/1-a.png"
	cases := []struct {
		name       string
		store      objectStore
		method     string
		wantStatus int
		wantCause  string
	}{
		{"stat failure", &fakeStore{existsErr: errors.New("minio stat exploded")}, http.MethodPut, http.StatusBadGateway, "minio stat exploded"},
		{"put failure", &fakeStore{putErr: errors.New("minio put exploded")}, http.MethodPut, http.StatusBadGateway, "minio put exploded"},
		{"get failure", &failingGetStore{}, http.MethodGet, http.StatusBadGateway, "minio get exploded"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			logs := &logCapture{}
			prev := slog.Default()
			slog.SetDefault(slog.New(logs))
			t.Cleanup(func() { slog.SetDefault(prev) })

			h := newHandlerWithStore(tc.store)
			req := httptest.NewRequest(tc.method, url, strings.NewReader("bytes"))
			req = req.WithContext(context.WithValue(req.Context(), probeKey{}, "req-1"))
			rec := httptest.NewRecorder()
			if tc.method == http.MethodPut {
				h.Put(rec, req)
			} else {
				h.Get(rec, req)
			}

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tc.wantStatus)
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
				t.Fatalf("Content-Type = %q, want application/problem+json", ct)
			}
			if len(logs.msgs) != 1 {
				t.Fatalf("log records = %d, want 1 (%v)", len(logs.msgs), logs.msgs)
			}
			if !strings.Contains(logs.msgs[0], tc.wantCause) {
				t.Fatalf("log %q does not carry the cause %q", logs.msgs[0], tc.wantCause)
			}
			if logs.ctxs[0].Value(probeKey{}) != "req-1" {
				t.Fatal("log record must carry the request context so request_id is stamped")
			}
		})
	}
}

// Refusals answer as problem+json.
// Client mistakes do too, not only failures.
func TestHandler_RefusalsRenderProblem(t *testing.T) {
	cases := []struct {
		name       string
		url        string
		store      objectStore
		wantStatus int
	}{
		{"unknown bucket", "/storage/object?bucket=nope&key=a.png", &fakeStore{}, http.StatusBadRequest},
		{"traversal key", "/storage/object?bucket=" + BucketItemImages + "&key=../a.png", &fakeStore{}, http.StatusBadRequest},
		{"bad extension", "/storage/object?bucket=" + BucketItemImages + "&key=items/7/a.exe", &fakeStore{}, http.StatusBadRequest},
		{"existing key", "/storage/object?bucket=" + BucketItemImages + "&key=items/7/a.png", &fakeStore{exists: true}, http.StatusConflict},
		{"no storage", "/storage/object?bucket=" + BucketItemImages + "&key=items/7/a.png", nil, http.StatusServiceUnavailable},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := &Handler{store: tc.store}
			if tc.store == nil {
				h = NewHandler(nil)
			}
			rec := httptest.NewRecorder()
			h.Put(rec, httptest.NewRequest(http.MethodPut, tc.url, strings.NewReader("x")))
			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tc.wantStatus)
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
				t.Fatalf("Content-Type = %q, want application/problem+json", ct)
			}
		})
	}
}
