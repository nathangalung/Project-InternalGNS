// Package testutil hosts test helpers.
package testutil

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	dbmig "github.com/nathangalung/internalgns/apps/api/internal/shared/db"
)

const defaultDSN = "postgres://gns_app:gns_app@localhost:5432/gns_quotation?sslmode=disable"

var (
	poolOnce   sync.Once
	poolErr    error
	sharedPool *pgxpool.Pool
)

// DSN returns the test DSN.
func DSN() string {
	if v := os.Getenv("TEST_DATABASE_URL"); v != "" {
		return v
	}
	if v := os.Getenv("DATABASE_URL"); v != "" {
		return v
	}
	return defaultDSN
}

// Pool builds a singleton pool.
func Pool(t testing.TB) *pgxpool.Pool {
	t.Helper()
	poolOnce.Do(func() {
		ctx := context.Background()
		cfg, err := pgxpool.ParseConfig(DSN())
		if err != nil {
			poolErr = err
			return
		}
		cfg.MaxConns = 8
		p, err := pgxpool.NewWithConfig(ctx, cfg)
		if err != nil {
			poolErr = err
			return
		}
		if err := p.Ping(ctx); err != nil {
			poolErr = err
			return
		}
		if err := dbmig.RunMigrations(ctx, p); err != nil {
			poolErr = err
			return
		}
		if err := SeedMasterIfMissing(ctx, p); err != nil {
			poolErr = err
			return
		}
		sharedPool = p
	})
	if poolErr != nil {
		t.Skipf("test postgres unavailable: %v", poolErr)
	}
	return sharedPool
}

// Begin tx with rollback cleanup.
func BeginTx(t testing.TB) (context.Context, pgx.Tx) {
	t.Helper()
	pool := Pool(t)
	ctx := context.Background()
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	t.Cleanup(func() {
		if err := tx.Rollback(context.Background()); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
			t.Logf("rollback: %v", err)
		}
	})
	return ctx, tx
}
