package db

import (
	"context"
	"database/sql"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/nathangalung/internalgns/apps/api/db/migrations"
)

// Apply pending goose migrations.
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

// database/sql backed by pgx.
func PlainDB(pool *pgxpool.Pool) *sql.DB {
	return stdlib.OpenDBFromPool(pool)
}
