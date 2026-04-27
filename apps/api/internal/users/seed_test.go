package users_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

func TestSeedSuperadmin_RejectsMissingEmail(t *testing.T) {
	pool := testutil.Pool(t)
	err := users.SeedSuperadmin(context.Background(), pool, users.SeedConfig{
		Name: "x", Password: "p",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "email and password required")
}

func TestSeedSuperadmin_RejectsMissingPassword(t *testing.T) {
	pool := testutil.Pool(t)
	err := users.SeedSuperadmin(context.Background(), pool, users.SeedConfig{
		Email: "e@e.local", Name: "x",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "email and password required")
}

func TestSeedSuperadmin_BcryptFailsOnLongPassword(t *testing.T) {
	pool := testutil.Pool(t)
	long := make([]byte, 80)
	for i := range long {
		long[i] = 'a'
	}
	err := users.SeedSuperadmin(context.Background(), pool, users.SeedConfig{
		Email: "x@x", Name: "n", Password: string(long),
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "bcrypt")
}

func TestSeedSuperadmin_IdempotentReRun(t *testing.T) {
	pool := testutil.Pool(t)
	cfg := users.SeedConfig{
		Email:    "test-seed-admin@local",
		Name:     "Test Seed",
		Password: "secret-seed",
	}
	require.NoError(t, users.SeedSuperadmin(context.Background(), pool, cfg))
	require.NoError(t, users.SeedSuperadmin(context.Background(), pool, cfg))
}
