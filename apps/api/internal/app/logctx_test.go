package app

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

// Records each log record with its context.
type ctxLogCapture struct {
	mu   sync.Mutex
	ctxs []context.Context
	msgs []string
}

func (c *ctxLogCapture) Enabled(context.Context, slog.Level) bool { return true }
func (c *ctxLogCapture) WithAttrs([]slog.Attr) slog.Handler       { return c }
func (c *ctxLogCapture) WithGroup(string) slog.Handler            { return c }
func (c *ctxLogCapture) Handle(ctx context.Context, r slog.Record) error {
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

func (c *ctxLogCapture) snapshot() ([]context.Context, []string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]context.Context(nil), c.ctxs...), append([]string(nil), c.msgs...)
}

func captureLogs(t *testing.T) *ctxLogCapture {
	t.Helper()
	c := &ctxLogCapture{}
	prev := slog.Default()
	slog.SetDefault(slog.New(c))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return c
}

type logProbeKey struct{}

// A database outage during authentication is a 500 the operator has to
// trace, so its log line must carry the request context for request_id.
func TestAuthMiddleware_DBErrorLogsWithRequestContext(t *testing.T) {
	logs := captureLogs(t)
	svc := auth.NewService(users.NewRepo(testutil.FakeExec{}, testutil.Store(t)), middlewareSecret, time.Hour)
	h := authMiddleware(svc)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("handler must not run when the account cannot be read")
	}))

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bearer "+mkToken(t, "1"))
	req = req.WithContext(context.WithValue(req.Context(), logProbeKey{}, "req-1"))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	require.Equal(t, http.StatusInternalServerError, rec.Code)
	ctxs, _ := logs.snapshot()
	require.Len(t, ctxs, 1)
	assert.Equal(t, "req-1", ctxs[0].Value(logProbeKey{}))
}

// A background sweep has no request, but its failure line should still go
// through the context-aware logger with the error under the usual key.
func TestRunRefreshPurgeLoop_LogsWithContext(t *testing.T) {
	logs := captureLogs(t)
	ctx, cancel := context.WithCancel(context.WithValue(t.Context(), logProbeKey{}, "sweep"))
	repo := &fakePurger{err: errors.New("purge exploded")}
	done := make(chan struct{})
	go func() {
		defer close(done)
		runRefreshPurgeLoop(ctx, repo, time.Hour)
	}()
	deadline := time.After(2 * time.Second)
	for {
		if _, msgs := logs.snapshot(); len(msgs) > 0 {
			break
		}
		select {
		case <-deadline:
			t.Fatal("purge failure was not logged")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	cancel()
	<-done

	ctxs, msgs := logs.snapshot()
	assert.Equal(t, "sweep", ctxs[0].Value(logProbeKey{}))
	assert.Contains(t, msgs[0], "error=purge exploded")
}
