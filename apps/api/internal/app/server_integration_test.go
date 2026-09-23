package app

import (
	"context"
	"log/slog"
	"sync"
	"testing"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// errorRecorder keeps every ERROR record logged.
type errorRecorder struct {
	mu   sync.Mutex
	msgs []string
}

func (h *errorRecorder) Enabled(context.Context, slog.Level) bool { return true }

func (h *errorRecorder) Handle(_ context.Context, r slog.Record) error {
	if r.Level < slog.LevelError {
		return nil
	}
	msg := r.Message
	r.Attrs(func(a slog.Attr) bool {
		msg += " " + a.String()
		return true
	})
	h.mu.Lock()
	defer h.mu.Unlock()
	h.msgs = append(h.msgs, msg)
	return nil
}

func (h *errorRecorder) WithAttrs([]slog.Attr) slog.Handler { return h }

func (h *errorRecorder) WithGroup(string) slog.Handler { return h }

func (h *errorRecorder) errors() []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]string(nil), h.msgs...)
}

// Bootstrap builds the server and closes it at once: the refresh purge
// must stop before the pool closes, so no sweep hits a closed pool.
func TestServer_CloseRightAfterBuildLogsNoError(t *testing.T) {
	testutil.RequireDB(t)
	rec := &errorRecorder{}
	prev := slog.Default()
	slog.SetDefault(slog.New(rec))
	t.Cleanup(func() { slog.SetDefault(prev) })

	// The seeded superadmin makes the boot seed a no-op.
	srv, err := NewServer(t.Context(), Config{
		DatabaseURL:        testutil.DSN(),
		JWTSecret:          "server-close-secret",
		SuperadminEmail:    "test-superadmin@globalsakti.local",
		SuperadminName:     "Test Superadmin",
		SuperadminPassword: "Unused-pw1!",
		TZ:                 "Asia/Jakarta",
	})
	if err != nil {
		t.Fatalf("new server: %v", err)
	}
	srv.Close()

	// Close joins the sweep, so nothing can log after it returns.
	select {
	case <-srv.purgeDone:
	default:
		t.Fatal("refresh purge still running after Close")
	}

	if errs := rec.errors(); len(errs) > 0 {
		t.Fatalf("shutdown logged errors: %q", errs)
	}
}
