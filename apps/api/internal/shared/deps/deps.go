// Package deps holds shared DI.
package deps

import (
	"context"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
)

// Deps holds shared application dependencies.
type Deps struct {
	Pool    db.Executor
	Queries queries.Store
}

// User id context key.

type ctxKey int

const userIDKey ctxKey = iota

// WithUserID stores user id.
func WithUserID(ctx context.Context, userID int64) context.Context {
	return context.WithValue(ctx, userIDKey, userID)
}

// CurrentUserID reads user id.
func CurrentUserID(ctx context.Context) int64 {
	if v, ok := ctx.Value(userIDKey).(int64); ok {
		return v
	}
	return 0
}
