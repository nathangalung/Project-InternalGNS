package testutil

import (
	"context"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestDSN_TestDatabaseURL(t *testing.T) {
	t.Setenv("TEST_DATABASE_URL", "postgres://test/db")
	t.Setenv("DATABASE_URL", "postgres://other/db")
	assert.Equal(t, "postgres://test/db", DSN())
}

func TestDSN_FallbackToDatabaseURL(t *testing.T) {
	require := assert.New(t)
	require.NoError(os.Unsetenv("TEST_DATABASE_URL"))
	t.Setenv("DATABASE_URL", "postgres://only-db/db")
	require.Equal("postgres://only-db/db", DSN())
}

func TestDSN_FallbackToDefault(t *testing.T) {
	require := assert.New(t)
	require.NoError(os.Unsetenv("TEST_DATABASE_URL"))
	require.NoError(os.Unsetenv("DATABASE_URL"))
	require.Equal(defaultDSN, DSN())
}

func TestPool_ReturnsSharedInstance(t *testing.T) {
	a := Pool(t)
	b := Pool(t)
	assert.Same(t, a, b)
}

func TestBeginTx_RollsBackOnCleanup(t *testing.T) {
	ctx, tx := BeginTx(t)
	assert.NotNil(t, ctx)
	assert.NotNil(t, tx)
}

func TestStore_LoadsQueries(t *testing.T) {
	s := Store(t)
	assert.NotEmpty(t, s)
}

func TestSeedMasterIfMissing_Idempotent(t *testing.T) {
	pool := Pool(t)
	require := assert.New(t)
	require.NoError(SeedMasterIfMissing(context.Background(), pool))
	require.NoError(SeedMasterIfMissing(context.Background(), pool))
}

func TestResetQuotationDomain_BadExec(t *testing.T) {
	err := ResetQuotationDomain(context.Background(), FakeExec{})
	assert.ErrorIs(t, err, ErrFake)
}

func TestCountingExec_PassThroughThenFail(t *testing.T) {
	_, tx := BeginTx(t)
	exec := &CountingExec{Inner: tx, FailAfter: 1}
	ctx := context.Background()

	rows, err := exec.Query(ctx, "SELECT 1")
	assert.NoError(t, err)
	if rows != nil {
		rows.Close()
	}

	_, err = exec.Query(ctx, "SELECT 1")
	assert.ErrorIs(t, err, ErrFake)
}

func TestCountingExec_QueryRowAndExec(t *testing.T) {
	_, tx := BeginTx(t)
	exec := &CountingExec{Inner: tx, FailAfter: 1}
	ctx := context.Background()

	var n int
	require := assert.New(t)
	require.NoError(exec.QueryRow(ctx, "SELECT 1").Scan(&n))

	require.Error(exec.QueryRow(ctx, "SELECT 1").Scan(&n))

	exec2 := &CountingExec{Inner: tx, FailAfter: 1}
	_, err := exec2.Exec(ctx, "SELECT 1")
	require.NoError(err)
	_, err = exec2.Exec(ctx, "SELECT 1")
	require.ErrorIs(err, ErrFake)
}

func TestFakeRow_Scan(t *testing.T) {
	r := fakeRow{}
	assert.ErrorIs(t, r.Scan(nil), ErrFake)
}

func TestFakeExec_QueryRowAndExec(t *testing.T) {
	f := FakeExec{}
	ctx := context.Background()

	var n int
	assert.ErrorIs(t, f.QueryRow(ctx, "x").Scan(&n), ErrFake)

	_, err := f.Exec(ctx, "x")
	assert.ErrorIs(t, err, ErrFake)
}
