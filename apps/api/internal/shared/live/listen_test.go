package live_test

import (
	"context"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/live"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// NOTIFY reaches subscribers.
func TestListen_DeliversNotifications(t *testing.T) {
	pool := testutil.Pool(t)
	h := live.NewHub()
	ch, stop := h.Subscribe(424242)
	defer stop()

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		live.Listen(ctx, pool, h, 10*time.Millisecond)
		close(done)
	}()

	// LISTEN is asynchronous; keep notifying until one lands.
	payload := `{"quotationId": 424242, "kind": "line", "part": "line:5", "userId": 1}`
	deadline := time.After(5 * time.Second)
	var got live.Event
wait:
	for {
		_, err := pool.Exec(ctx, "SELECT pg_notify($1, $2)", live.Channel, payload)
		require.NoError(t, err)
		select {
		case got = <-ch:
			break wait
		case <-time.After(50 * time.Millisecond):
		case <-deadline:
			t.Fatal("no notification delivered")
		}
	}
	assert.Equal(t, live.Event{QuotationID: 424242, Kind: "line", Part: "line:5", UserID: 1}, got)

	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Listen did not stop on cancel")
	}
}

// A lost database is retried.
// Listen keeps backing off until it is cancelled instead of giving up.
func TestListen_RetriesUntilCancelled(t *testing.T) {
	if testutil.DSN() == "" {
		t.Skip("needs TEST_DATABASE_URL")
	}
	pool, err := pgxpool.New(context.Background(), testutil.DSN())
	require.NoError(t, err)
	pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	start := time.Now()
	live.Listen(ctx, pool, live.NewHub(), 10*time.Millisecond)
	assert.GreaterOrEqual(t, time.Since(start), 140*time.Millisecond, "kept retrying until the deadline")
}

// retryLog records each logged backoff.
type retryLog struct {
	mu    sync.Mutex
	waits []string
}

func (l *retryLog) Enabled(context.Context, slog.Level) bool { return true }
func (l *retryLog) WithAttrs([]slog.Attr) slog.Handler       { return l }
func (l *retryLog) WithGroup(string) slog.Handler            { return l }
func (l *retryLog) Handle(_ context.Context, r slog.Record) error {
	r.Attrs(func(a slog.Attr) bool {
		if a.Key == "retry" {
			l.mu.Lock()
			l.waits = append(l.waits, a.Value.String())
			l.mu.Unlock()
		}
		return true
	})
	return nil
}

func (l *retryLog) snapshot() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]string(nil), l.waits...)
}

// listenerPID waits for a listening backend.
// not skips the backend that was just terminated.
func listenerPID(t *testing.T, pool *pgxpool.Pool, not int32) int32 {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		var pid int32
		err := pool.QueryRow(context.Background(), `
			SELECT pid FROM pg_stat_activity
			WHERE application_name = $1 AND datname = current_database()
			  AND query = 'LISTEN ' || $2 AND pid <> $3
			LIMIT 1`, live.ApplicationName, live.Channel, not).Scan(&pid)
		if err == nil {
			return pid
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("no listening backend")
	return 0
}

// A re-LISTEN resyncs every viewer.
// Notices sent while the connection was down are lost, so open editors are
// told to reload, and the backoff starts over after each success.
func TestListen_ReconnectResyncs(t *testing.T) {
	pool := testutil.Pool(t)
	logs := &retryLog{}
	prev := slog.Default()
	slog.SetDefault(slog.New(logs))
	t.Cleanup(func() { slog.SetDefault(prev) })

	h := live.NewHub()
	ch, stop := h.Subscribe(424243)
	defer stop()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		live.Listen(ctx, pool, h, 10*time.Millisecond)
		close(done)
	}()
	defer func() {
		cancel()
		<-done
	}()

	pid := listenerPID(t, pool, 0)
	quiet(t, ch) // the first LISTEN has missed nothing
	for drop := range 2 {
		_, err := pool.Exec(ctx, "SELECT pg_terminate_backend($1)", pid)
		require.NoError(t, err)
		select {
		case ev := <-ch:
			assert.Equal(t, live.Event{QuotationID: 424243, Kind: live.KindResync}, ev, "drop %d", drop)
		case <-time.After(5 * time.Second):
			t.Fatalf("no resync after drop %d", drop)
		}
		pid = listenerPID(t, pool, pid)
	}
	assert.Equal(t, []string{"10ms", "10ms"}, logs.snapshot(), "each drop starts the backoff over")

	_, err := pool.Exec(ctx, "SELECT pg_notify($1, $2)", live.Channel,
		`{"quotationId": 424243, "kind": "line", "userId": 1}`)
	require.NoError(t, err)
	assert.Equal(t, "line", recv(t, ch).Kind, "the new LISTEN delivers")
}
