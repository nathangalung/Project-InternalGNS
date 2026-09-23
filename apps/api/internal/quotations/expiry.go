package quotations

import (
	"context"
	"log/slog"
	"time"
)

// ExpiryInterval is the job period.
// Expiry is decided by the WIB date, so running hourly is idempotent: it only
// bounds how long after midnight WIB a quotation keeps showing Dikirim, and a
// run after downtime catches up every missed day at once.
const ExpiryInterval = time.Hour

// Expirer is the job's only dependency.
type Expirer interface {
	ExpireDue(ctx context.Context, asOf time.Time) (int64, error)
}

// RunExpiryLoop runs until ctx ends.
// It runs once at startup, then every interval, asking now for the instant
// each run judges against. The advisory lock inside fn_expire_quotations keeps
// two replicas from both doing the work. Errors are logged and the loop
// continues: a failed run must not stop the server.
func RunExpiryLoop(ctx context.Context, repo Expirer, interval time.Duration, now func() time.Time) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		if ctx.Err() != nil {
			return
		}
		if n, err := repo.ExpireDue(ctx, now()); err != nil {
			if ctx.Err() != nil {
				return
			}
			slog.ErrorContext(ctx, "quotation expiry", "error", err.Error())
		} else if n > 0 {
			slog.InfoContext(ctx, "quotation expiry", "expired", n)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
