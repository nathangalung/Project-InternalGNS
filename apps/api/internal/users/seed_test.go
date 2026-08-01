package users_test

import (
	"context"
	"strconv"
	"strings"
	"testing"
	"time"

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

// Two distinct emails seeded back-to-back must both end up as active
// superadmins. Mirrors the boot path that seeds SUPERADMIN_* then
// SUPERADMIN2_* when both are configured.
func TestSeedSuperadmin_TwoDistinctAccounts(t *testing.T) {
	pool := testutil.Pool(t)
	ctx := context.Background()

	require.NoError(t, users.SeedSuperadmin(ctx, pool, users.SeedConfig{
		Email: "primary-admin@local", Name: "Primary", Password: "pw-primary",
	}))
	require.NoError(t, users.SeedSuperadmin(ctx, pool, users.SeedConfig{
		Email: "secondary-admin@local", Name: "Secondary", Password: "pw-secondary",
	}))

	var count int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM users
		 WHERE role = 'superadmin' AND is_active = TRUE
		   AND email IN ('primary-admin@local', 'secondary-admin@local')`,
	).Scan(&count))
	assert.Equal(t, 2, count)
}

// A user row cannot be deleted (the self-referential audit FKs are ON DELETE
// RESTRICT), so a fixed fixture address would let a row left by an earlier run
// satisfy the assertions vacuously. Every seed test below gets its own.
func uniqueSeedEmail(prefix string) string {
	return prefix + "-" + strconv.FormatInt(time.Now().UnixNano(), 10) + "@Local"
}

// A mixed-case SUPERADMIN_EMAIL must be stored case-folded, matching what
// users.Repo writes and what users_email_lower_idx (00045) indexes.
func TestSeedSuperadmin_MixedCaseEmailStoredCaseFolded(t *testing.T) {
	pool := testutil.Pool(t)
	ctx := context.Background()
	configured := "  " + uniqueSeedEmail("Mixed.Case-Admin") + "  "
	lowered := strings.ToLower(strings.TrimSpace(configured))

	require.NoError(t, users.SeedSuperadmin(ctx, pool, users.SeedConfig{
		Email: configured, Name: "Mixed Case Admin", Password: "pw-mixed-case",
	}))

	var stored string
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT email FROM users WHERE LOWER(email) = $1`, lowered).Scan(&stored))
	assert.Equal(t, lowered, stored, "seed must store the canonical case-folded address")
}

// The boot-time re-seed must recognise its own row after that row has been
// case-folded, and must not create a second one.
//
// Reproduces the reported outage: a mixed-case SUPERADMIN_EMAIL, an admin edit
// that rewrites the row through normalizeEmail, then a restart. The old
// statement used ON CONFLICT (email), which can only infer users_email_key --
// not the expression index on LOWER(email) -- so the re-insert violated
// users_email_lower_idx, SeedSuperadmin returned an error, NewServer
// propagated it and the API never started.
func TestSeedSuperadmin_ReseedMatchesCaseFoldedRow(t *testing.T) {
	pool := testutil.Pool(t)
	ctx := context.Background()
	configured := uniqueSeedEmail("Reseed.Admin")
	lowered := strings.ToLower(configured)
	cfg := users.SeedConfig{Email: configured, Name: "Reseed Admin", Password: "pw-reseed"}

	// A row written before normalizeEmail existed and never backfilled: the
	// stored casing differs from the configured one only after folding.
	_, err := pool.Exec(ctx,
		`INSERT INTO users (email, name, password_hash, role, is_active, created_by, updated_by)
		 VALUES ($1, 'Legacy Admin', 'x', 'superadmin', TRUE, NULL, NULL)`, configured)
	require.NoError(t, err)

	require.NoError(t, users.SeedSuperadmin(ctx, pool, cfg),
		"re-seed over a mixed-case row must be a no-op, not an error")

	// And again once the row has been case-folded, as an admin edit does.
	_, err = pool.Exec(ctx,
		`UPDATE users SET email = LOWER(BTRIM(email)), name = 'Renamed By Admin'
		 WHERE LOWER(email) = $1`, lowered)
	require.NoError(t, err)

	require.NoError(t, users.SeedSuperadmin(ctx, pool, cfg),
		"re-seed after the row was case-folded must be a no-op, not an error")

	var count int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM users WHERE LOWER(email) = $1`, lowered).Scan(&count))
	assert.Equal(t, 1, count, "seeding must never duplicate the superadmin")
}
