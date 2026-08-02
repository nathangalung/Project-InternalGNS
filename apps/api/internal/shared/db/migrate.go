package db

import (
	"context"
	"database/sql"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/lock"

	"github.com/nathangalung/internalgns/apps/api/db/migrations"
)

// Apply pending goose migrations under a Postgres advisory lock, so two
// instances booting at once cannot run migrations concurrently.
func RunMigrations(ctx context.Context, pool *pgxpool.Pool) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()

	sqldb := stdlib.OpenDB(*conn.Conn().Config())
	defer func() { _ = sqldb.Close() }()

	locker, err := lock.NewPostgresSessionLocker()
	if err != nil {
		return err
	}
	provider, err := goose.NewProvider(goose.DialectPostgres, sqldb, migrations.FS,
		goose.WithSessionLocker(locker))
	if err != nil {
		return err
	}
	_, err = provider.Up(ctx)
	return err
}

// database/sql backed by pgx.
func PlainDB(pool *pgxpool.Pool) *sql.DB {
	return stdlib.OpenDBFromPool(pool)
}
