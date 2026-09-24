package db_test

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

func TestWithTx_Commits(t *testing.T) {
	pool := testutil.Pool(t)
	ctx := context.Background()
	require.NoError(t, db.WithTx(ctx, pool, func(tx pgx.Tx) error {
		var n int
		return tx.QueryRow(ctx, "SELECT 1").Scan(&n)
	}))
}

func TestWithTx_RollsBackOnError(t *testing.T) {
	pool := testutil.Pool(t)
	ctx := context.Background()
	sentinel := errors.New("boom")
	err := db.WithTx(ctx, pool, func(_ pgx.Tx) error { return sentinel })
	assert.ErrorIs(t, err, sentinel)
}

func TestNewPool_BadDSN(t *testing.T) {
	_, err := db.NewPool(context.Background(), "not-a-real-dsn::::", "Asia/Jakarta")
	assert.Error(t, err)
}

func TestNewPool_BadHost(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := db.NewPool(ctx, "postgres://nobody@127.0.0.1:1/nope?sslmode=disable", "Asia/Jakarta")
	assert.Error(t, err)
}

func TestNewPool_HappyPath(t *testing.T) {
	_ = testutil.Pool(t)
	pool, err := db.NewPool(context.Background(), testutil.DSN(), "Asia/Jakarta")
	require.NoError(t, err)
	defer pool.Close()
	require.NoError(t, pool.Ping(context.Background()))
}

func TestWithTx_BeginErrorOnCancelledCtx(t *testing.T) {
	pool := testutil.Pool(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err := db.WithTx(ctx, pool, func(_ pgx.Tx) error { return nil })
	assert.Error(t, err)
}

func TestRunMigrations_AcquireErrorOnCancelledCtx(t *testing.T) {
	pool := testutil.Pool(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err := db.RunMigrations(ctx, pool)
	assert.Error(t, err)
}

// WithTx takes any TxBeginner, so a repo can run it on the pool or nest it
// inside a caller's transaction, and a begin failure names its step.
func TestWithTx_BeginnerFailureIsWrapped(t *testing.T) {
	var b db.TxBeginner = testutil.FakeBeginner{}
	err := db.WithTx(context.Background(), b, func(_ pgx.Tx) error { return nil })
	require.ErrorIs(t, err, testutil.ErrFake)
	assert.Contains(t, err.Error(), "begin tx")
}

// A failed commit is reported and nothing persists.
// A deferred constraint only fires at COMMIT, after fn has returned nil, so
// WithTx must still surface it (wrapped, with its SQLSTATE reachable) rather
// than report success for rows that were rolled back.
func TestWithTx_CommitFailureIsReported(t *testing.T) {
	pool := testutil.Pool(t)
	ctx := context.Background()

	err := db.WithTx(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `CREATE TEMP TABLE withtx_deferred (
			v int UNIQUE DEFERRABLE INITIALLY DEFERRED) ON COMMIT DROP`); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO withtx_deferred VALUES (1), (1)`)
		return err
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "commit tx")
	var pgErr *pgconn.PgError
	require.ErrorAs(t, err, &pgErr)
	assert.Equal(t, db.SQLStateUniqueViolation, pgErr.Code)
}
