package live

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// maxRetry caps the reconnect backoff.
const maxRetry = 30 * time.Second

// Listen feeds the hub from NOTIFY.
// It holds one pool connection in LISTEN until ctx ends, and reconnects with
// doubling backoff from retry when the connection drops, so a database
// restart only pauses live updates.
func Listen(ctx context.Context, pool *pgxpool.Pool, h *Hub, retry time.Duration) {
	wait := retry
	for ctx.Err() == nil {
		err := listenOnce(ctx, pool, h)
		if ctx.Err() != nil {
			return
		}
		slog.WarnContext(ctx, "live listen dropped", "error", err, "retry", wait.String())
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
		wait = min(wait*2, maxRetry)
	}
}

// listenOnce serves one connection.
// The connection is closed rather than returned to the pool, so no other
// caller inherits a LISTEN session.
func listenOnce(ctx context.Context, pool *pgxpool.Pool, h *Hub) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	raw := conn.Hijack()
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = raw.Close(closeCtx)
	}()

	if _, err := raw.Exec(ctx, "LISTEN "+Channel); err != nil {
		return err
	}
	for {
		n, err := raw.WaitForNotification(ctx)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return nil
			}
			return err
		}
		if ev, ok := Parse(n.Payload); ok {
			h.Publish(ev)
		}
	}
}
