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
		Email:    uniqueSeedEmail("test-seed-admin"),
		Name:     "Test Seed",
		Password: "secret-seed",
	}
	dropSeeded(t, cfg.Email)
	require.NoError(t, users.SeedSuperadmin(context.Background(), pool, cfg))
	require.NoError(t, users.SeedSuperadmin(context.Background(), pool, cfg))

	var count int
	require.NoError(t, pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM users WHERE LOWER(email) = LOWER($1)`, cfg.Email).Scan(&count))
	assert.Equal(t, 1, count, "a re-run must not add a second account")
}

// Two seeded superadmins both activate.
// Two distinct emails seeded back-to-back must both end up active. Mirrors
// the boot path that seeds SUPERADMIN_* then SUPERADMIN2_* when both are
// configured.
func TestSeedSuperadmin_TwoDistinctAccounts(t *testing.T) {
	pool := testutil.Pool(t)
	ctx := context.Background()

	primary, secondary := uniqueSeedEmail("primary-admin"), uniqueSeedEmail("secondary-admin")
	dropSeeded(t, primary, secondary)
	require.NoError(t, users.SeedSuperadmin(ctx, pool, users.SeedConfig{
		Email: primary, Name: "Primary", Password: "pw-primary",
	}))
	require.NoError(t, users.SeedSuperadmin(ctx, pool, users.SeedConfig{
		Email: secondary, Name: "Secondary", Password: "pw-secondary",
	}))

	var count int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM users
		 WHERE role = 'superadmin' AND is_active = TRUE
		   AND email IN (LOWER($1), LOWER($2))`, primary, secondary,
	).Scan(&count))
	assert.Equal(t, 2, count)
}

// Unique seed address per test.
// A fixed fixture address would let a row left by an earlier run satisfy the
// assertions vacuously.
func uniqueSeedEmail(prefix string) string {
	return prefix + "-" + strconv.FormatInt(time.Now().UnixNano(), 10) + "@Local"
}

// dropSeeded deletes seeded accounts afterwards.
// A seeded row audits itself, and the audit FKs are ON DELETE RESTRICT, so
// the self-references are cleared before the delete.
func dropSeeded(t *testing.T, emails ...string) {
	t.Helper()
	lowered := make([]string, len(emails))
	for i, e := range emails {
		lowered[i] = strings.ToLower(strings.TrimSpace(e))
	}
	pool := testutil.Pool(t)
	t.Cleanup(func() {
		ctx := context.Background()
		for _, q := range []string{
			`UPDATE users SET created_by = NULL, updated_by = NULL WHERE LOWER(email) = ANY($1)`,
			`DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE LOWER(email) = ANY($1))`,
			`DELETE FROM users WHERE LOWER(email) = ANY($1)`,
		} {
			if _, err := pool.Exec(ctx, q, lowered); err != nil {
				t.Errorf("drop seeded accounts: %v", err)
				return
			}
		}
	})
}

// Seeded email is case-folded.
// A mixed-case SUPERADMIN_EMAIL must be stored as users.Repo writes it and
// as users_email_lower_idx (00045) indexes it.
func TestSeedSuperadmin_MixedCaseEmailStoredCaseFolded(t *testing.T) {
	pool := testutil.Pool(t)
	ctx := context.Background()
	configured := "  " + uniqueSeedEmail("Mixed.Case-Admin") + "  "
	dropSeeded(t, configured)
	lowered := strings.ToLower(strings.TrimSpace(configured))

	require.NoError(t, users.SeedSuperadmin(ctx, pool, users.SeedConfig{
		Email: configured, Name: "Mixed Case Admin", Password: "pw-mixed-case",
	}))

	var stored string
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT email FROM users WHERE LOWER(email) = $1`, lowered).Scan(&stored))
	assert.Equal(t, lowered, stored, "seed must store the canonical case-folded address")
}

// Re-seed recognises case-folded rows.
// The boot-time re-seed must not create a second row after its own was
// case-folded.
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
	dropSeeded(t, configured)
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

// Seed failures stop the boot.
// A seed that cannot open its transaction, or whose row the table refuses,
// must fail loudly instead of booting with no superadmin.
func TestSeedSuperadmin_StorageFailuresSurface(t *testing.T) {
	pool := testutil.Pool(t)
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()

	tests := []struct {
		name string
		ctx  context.Context
		cfg  users.SeedConfig
		want string
	}{
		{"cancelled before begin", cancelled, users.SeedConfig{
			Email: "seed-cancel@test.local", Name: "Seed", Password: "Seed-pw1!",
		}, "context canceled"},
		{"name longer than the column", context.Background(), users.SeedConfig{
			Email: "seed-long-name@test.local", Name: strings.Repeat("n", 256), Password: "Seed-pw1!",
		}, "seed superadmin: insert:"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := users.SeedSuperadmin(tc.ctx, pool, tc.cfg)
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.want)

			var n int
			require.NoError(t, pool.QueryRow(context.Background(),
				`SELECT COUNT(*) FROM users WHERE email = $1`, tc.cfg.Email).Scan(&n))
			assert.Zero(t, n, "a failed seed writes nothing")
		})
	}
}
