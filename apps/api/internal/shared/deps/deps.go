// Package deps provides dependency injection container untuk semua domain.
// Setiap domain Routes() menerima Deps dan extract apa yang dibutuhkan.
package deps

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Deps holds shared application dependencies.
type Deps struct {
	Pool *pgxpool.Pool
}

// ─── Auth context helpers ────────────────────────────────────
// JWT middleware nantinya akan set userIDKey di request context.
// CurrentUserID() extracts the user id; returns 0 kalau tidak ada
// (dev/test only — production middleware harus reject unauthenticated).

type ctxKey int

const userIDKey ctxKey = iota

// WithUserID returns a new context with user_id stored.
// Dipanggil oleh JWT auth middleware setelah verify token.
func WithUserID(ctx context.Context, userID int64) context.Context {
	return context.WithValue(ctx, userIDKey, userID)
}

// CurrentUserID extracts the authenticated user id from context.
// Returns 0 kalau tidak di-set (TODO: middleware should always set).
func CurrentUserID(ctx context.Context) int64 {
	if v, ok := ctx.Value(userIDKey).(int64); ok {
		return v
	}
	return 0
}
