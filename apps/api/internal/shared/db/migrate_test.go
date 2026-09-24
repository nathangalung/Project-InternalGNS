package db_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Failed migration run is reported.
// A goose_db_version table without goose's columns makes provider.Up fail
// on its first query, and RunMigrations must surface that PgError wrapped.
func TestRunMigrations_UpFailureIsWrapped(t *testing.T) {
	admin := testutil.Pool(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	schema := fmt.Sprintf("goose_up_fail_%d", time.Now().UnixNano())
	_, err := admin.Exec(ctx, "CREATE SCHEMA "+schema)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
	})
	_, err = admin.Exec(ctx, "CREATE TABLE "+schema+".goose_db_version (bogus int)")
	require.NoError(t, err)

	cfg, err := pgxpool.ParseConfig(testutil.DSN())
	require.NoError(t, err)
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	require.NoError(t, err)
	defer pool.Close()

	err = db.RunMigrations(ctx, pool)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "apply migrations")
	var pgErr *pgconn.PgError
	require.ErrorAs(t, err, &pgErr)
	assert.Equal(t, "42703", pgErr.Code, "undefined_column from the bogus table")
}

// Provider build failure is reported.
// goose merges its process-global Go migration registry into the provider,
// so a Go migration registered at a version the embedded SQL set already
// uses makes goose.NewProvider refuse, before any SQL reaches the database.
func TestRunMigrations_ProviderFailureIsWrapped(t *testing.T) {
	pool := testutil.Pool(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	require.NoError(t, goose.SetGlobalMigrations(goose.NewGoMigration(1, nil, nil)))
	t.Cleanup(goose.ResetGlobalMigrations)

	err := db.RunMigrations(ctx, pool)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "migration provider")
	assert.Contains(t, err.Error(), "duplicate migration version 1")
}
