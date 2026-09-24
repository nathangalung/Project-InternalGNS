package app

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// bootConfig is a config the seed accepts.
func bootConfig() Config {
	return Config{
		Env:                "test",
		DatabaseURL:        testutil.DSN(),
		JWTSecret:          "boot-test-secret",
		JWTExpiry:          time.Hour,
		CORSAllowedOrigins: []string{"*"},
		SuperadminEmail:    "test-superadmin@globalsakti.local",
		SuperadminName:     "Test Superadmin",
		SuperadminPassword: "Unused-pw1!",
		TZ:                 "Asia/Jakarta",
	}
}

// trackSeeded deletes a boot-seeded account after the test.
func trackSeeded(t *testing.T, cleaner *testutil.Cleaner, email string) {
	t.Helper()
	var id int64
	err := testutil.Pool(t).QueryRow(context.Background(),
		`SELECT id FROM users WHERE lower(email) = lower($1)`, email).Scan(&id)
	if err == nil {
		cleaner.User(id)
	}
}

// openPool opens a pool in a given session zone.
func openPool(t *testing.T, zone string) *pgxpool.Pool {
	t.Helper()
	testutil.RequireDB(t)
	p, err := db.NewPool(context.Background(), testutil.DSN(), zone)
	require.NoError(t, err)
	t.Cleanup(p.Close)
	return p
}

// The boot refuses a database in the wrong zone.
// Invoice dates and document numbers read CURRENT_DATE, so a session left
// in UTC would stamp yesterday's date for the first seven hours of a WIB day.
func TestBuildServer_RefusesWrongSessionZone(t *testing.T) {
	pool := openPool(t, "UTC")
	_, _, err := buildServer(context.Background(), bootConfig(), pool)
	require.ErrorContains(t, err, `db session timezone is "UTC", want "Asia/Jakarta"`)
}

// A database that goes away mid-boot fails the boot.
func TestBuildServer_UnreachableDatabase(t *testing.T) {
	cases := []struct {
		name string
		tz   string
		want string
	}{
		{"zone check", "Asia/Jakarta", "read db session timezone"},
		{"migrations", "", "run migrations"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			pool := openPool(t, "Asia/Jakarta")
			pool.Close()
			cfg := bootConfig()
			cfg.TZ = c.tz
			_, _, err := buildServer(context.Background(), cfg, pool)
			require.ErrorContains(t, err, c.want)
		})
	}
}

// The optional second superadmin is seeded only when complete.
func TestBuildServer_SecondSuperadmin(t *testing.T) {
	pool := openPool(t, "Asia/Jakarta")
	cleaner := testutil.NewCleaner(t)
	run := time.Now().UnixNano()

	t.Run("seeded when email and password are set", func(t *testing.T) {
		email := fmt.Sprintf("boot-second-%d@test.local", run)
		cfg := bootConfig()
		cfg.Superadmin2Email, cfg.Superadmin2Name, cfg.Superadmin2Password = email, "Second Admin", "Second-pw1!"
		_, _, err := buildServer(context.Background(), cfg, pool)
		trackSeeded(t, cleaner, email)
		require.NoError(t, err)

		var role string
		var active bool
		require.NoError(t, pool.QueryRow(context.Background(),
			`SELECT role, is_active FROM users WHERE email = $1`, email).Scan(&role, &active))
		assert.Equal(t, "superadmin", role)
		assert.True(t, active)
	})

	t.Run("skipped without a password", func(t *testing.T) {
		email := fmt.Sprintf("boot-second-nopw-%d@test.local", run)
		cfg := bootConfig()
		cfg.Superadmin2Email = email
		_, _, err := buildServer(context.Background(), cfg, pool)
		require.NoError(t, err)
		var n int
		require.NoError(t, pool.QueryRow(context.Background(),
			`SELECT count(*) FROM users WHERE email = $1`, email).Scan(&n))
		assert.Zero(t, n)
	})

	t.Run("a password bcrypt refuses fails the boot", func(t *testing.T) {
		cfg := bootConfig()
		cfg.Superadmin2Email = fmt.Sprintf("boot-second-long-%d@test.local", run)
		cfg.Superadmin2Password = strings.Repeat("p", 80)
		_, _, err := buildServer(context.Background(), cfg, pool)
		require.ErrorContains(t, err, "seed second superadmin")
	})
}

// Storage is optional but never silently broken.
// Missing keys boot without the asset routes; keys pointing at an
// unreachable store fail the boot instead of serving 502s later.
func TestBuildServer_Storage(t *testing.T) {
	pool := openPool(t, "Asia/Jakarta")

	t.Run("no keys: asset routes absent", func(t *testing.T) {
		srv, _, err := buildServer(context.Background(), bootConfig(), pool)
		require.NoError(t, err)
		rec := httptest.NewRecorder()
		srv.Handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/storage/object?bucket=po-docs&key=a.pdf", nil))
		assert.Equal(t, http.StatusNotFound, rec.Code, "no store, no asset route")
	})

	t.Run("unreachable store fails the boot", func(t *testing.T) {
		cfg := bootConfig()
		cfg.MinioEndpoint, cfg.MinioAccessKey, cfg.MinioSecretKey = "127.0.0.1:1", "k", "s"
		_, _, err := buildServer(context.Background(), cfg, pool)
		require.ErrorContains(t, err, "init storage")
	})

	t.Run("reachable store mounts the asset routes", func(t *testing.T) {
		endpoint := os.Getenv("MINIO_ENDPOINT")
		if endpoint == "" {
			t.Skip("MINIO_ENDPOINT not set")
		}
		cfg := bootConfig()
		cfg.MinioEndpoint, cfg.MinioAccessKey, cfg.MinioSecretKey = endpoint, envOr("MINIO_ACCESS_KEY", "minioadmin"), envOr("MINIO_SECRET_KEY", "minioadmin")
		srv, _, err := buildServer(context.Background(), cfg, pool)
		require.NoError(t, err)
		rec := httptest.NewRecorder()
		srv.Handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/storage/object?bucket=po-docs&key=a.pdf", nil))
		assert.Equal(t, http.StatusUnauthorized, rec.Code, "the route exists and asks for a session")
	})
}

// Close tolerates a server that never built.
func TestServer_CloseNil(t *testing.T) {
	var s *Server
	assert.NotPanics(t, s.Close)
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
