// Package testutil hosts test helpers.
package testutil

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	dbmig "github.com/nathangalung/internalgns/apps/api/internal/shared/db"
)

// Suffix every resettable database carries.
const testDBSuffix = "test"

const missingDSNHint = "TEST_DATABASE_URL is not set; run `make test-api-ci` for a throwaway database"

var (
	poolOnce     sync.Once
	poolSkipErr  error
	poolFatalErr error
	sharedPool   *pgxpool.Pool
)

// DSN returns the test DSN.
//
// Only TEST_DATABASE_URL is read. DATABASE_URL points at the dev or
// production database, and the suites truncate, so a fallback would let a
// plain `go test` wipe live data.
func DSN() string {
	return os.Getenv("TEST_DATABASE_URL")
}

// Accept only test database names.
func isTestDatabaseName(name string) bool {
	return strings.HasSuffix(name, testDBSuffix)
}

// Pool builds a singleton pool.
//
// An unreachable postgres skips, because not every machine runs one. A bad
// DSN, a failed migration or a failed seed is a real defect and fails.
func Pool(t testing.TB) *pgxpool.Pool {
	t.Helper()
	if DSN() == "" {
		t.Skip(missingDSNHint)
	}
	poolOnce.Do(func() {
		ctx := context.Background()
		cfg, err := pgxpool.ParseConfig(DSN())
		if err != nil {
			poolFatalErr = err
			return
		}
		// Match the app pool: pin the business zone so date-derived assertions
		// do not depend on the server default.
		cfg.ConnConfig.RuntimeParams["timezone"] = "Asia/Jakarta"
		cfg.MaxConns = 8
		p, err := pgxpool.NewWithConfig(ctx, cfg)
		if err != nil {
			poolSkipErr = err
			return
		}
		if err := p.Ping(ctx); err != nil {
			poolSkipErr = err
			return
		}
		if err := dbmig.RunMigrations(ctx, p); err != nil {
			poolFatalErr = err
			return
		}
		if err := SeedMasterIfMissing(ctx, p); err != nil {
			poolFatalErr = err
			return
		}
		sharedPool = p
	})
	if poolFatalErr != nil {
		t.Fatalf("test database setup: %v", poolFatalErr)
	}
	if poolSkipErr != nil {
		t.Skipf("test postgres unavailable: %v", poolSkipErr)
	}
	return sharedPool
}

// Skip suite without test DB.
func RequireDB(t testing.TB) {
	t.Helper()
	Pool(t)
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
