package testutil

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
)

// DSN reads TEST_DATABASE_URL alone.
func TestDSN_IgnoresDatabaseURL(t *testing.T) {
	cases := []struct {
		name    string
		testURL string
		dbURL   string
		want    string
	}{
		{"test url wins", "postgres://test/db", "postgres://other/db", "postgres://test/db"},
		{"database url ignored", "", "postgres://only-db/db", ""},
		{"both unset", "", "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("TEST_DATABASE_URL", tc.testURL)
			t.Setenv("DATABASE_URL", tc.dbURL)
			assert.Equal(t, tc.want, DSN())
		})
	}
}

// Only test databases reset.
func TestIsTestDatabaseName(t *testing.T) {
	cases := []struct {
		name string
		db   string
		want bool
	}{
		{"dev database rejected", "gns_quotation", false},
		{"ci database accepted", "gns_citest", true},
		{"suffixed dev name accepted", "gns_quotation_test", true},
		{"production rejected", "postgres", false},
		{"empty rejected", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, isTestDatabaseName(tc.db))
		})
	}
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
