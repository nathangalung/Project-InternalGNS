package live_test

import (
	"context"
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
