package db

import (
	"context"
	"database/sql"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/nathangalung/internalgns/apps/api/migrations"
)

// RunMigrations applies all pending goose migrations using the given pool.
// Seeds and checks are NOT applied here — they live under migrations/seeds
// and migrations/checks and are invoked via Makefile targets in dev/staging.
func RunMigrations(ctx context.Context, pool *pgxpool.Pool) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()

	sqldb := stdlib.OpenDB(*conn.Conn().Config())
	defer func() { _ = sqldb.Close() }()

	goose.SetBaseFS(migrations.FS)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	return goose.UpContext(ctx, sqldb, ".")
}

// PlainDB exposes a *sql.DB backed by pgx for callers that need database/sql
// interop (e.g. one-shot migration tooling). Not for request paths.
func PlainDB(pool *pgxpool.Pool) *sql.DB {
	return stdlib.OpenDBFromPool(pool)
}
