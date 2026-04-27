package db_test

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
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
	_, err := db.NewPool(context.Background(), "not-a-real-dsn::::")
	assert.Error(t, err)
}

func TestNewPool_BadHost(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := db.NewPool(ctx, "postgres://nobody@127.0.0.1:1/nope?sslmode=disable")
	assert.Error(t, err)
}

func TestNewPool_HappyPath(t *testing.T) {
	_ = testutil.Pool(t)
	pool, err := db.NewPool(context.Background(), testutil.DSN())
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

func TestPlainDB(t *testing.T) {
	pool := testutil.Pool(t)
	sqldb := db.PlainDB(pool)
	require.NotNil(t, sqldb)
	defer sqldb.Close()
	require.NoError(t, sqldb.PingContext(context.Background()))
}
