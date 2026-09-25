package app

import (
	"context"
	"log/slog"
	"time"
)

// Refresh-token retention sweep.

// refreshPurgeInterval is the sweep period.
// The retention window itself lives in the auth.refresh_purge_expired query.
const refreshPurgeInterval = 24 * time.Hour

// refreshPurger is the sweep's dependency.
// It is kept small so the loop is testable without a database.
type refreshPurger interface {
	PurgeExpired(ctx context.Context) (int64, error)
}

// runRefreshPurgeLoop sweeps until cancelled.
// It sweeps once immediately, then every interval. Sweeping at startup
// matters because a service restarting more often than the interval would
// otherwise never purge. Errors are logged and the loop continues: a failed
// purge must not take the server down.
func runRefreshPurgeLoop(ctx context.Context, repo refreshPurger, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		if ctx.Err() != nil {
			return
		}
		if n, err := repo.PurgeExpired(ctx); err != nil {
			if ctx.Err() != nil {
				return
			}
			slog.ErrorContext(ctx, "refresh token purge", "error", err.Error())
		} else if n > 0 {
			slog.InfoContext(ctx, "refresh token purge", "deleted", n)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
