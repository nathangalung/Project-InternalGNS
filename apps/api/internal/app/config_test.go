package app

import (
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A 40-byte placeholder that satisfies the length guard; not a real key.
var testSecret = strings.Repeat("x", 40)

func TestLoadConfig_HappyPath(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://test:test@localhost:5432/test?sslmode=disable")
	t.Setenv("JWT_SECRET", testSecret)
	t.Setenv("JWT_EXPIRY", "12h")
	t.Setenv("HTTP_ADDR", ":9999")
	t.Setenv("CORS_ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173")

	c, err := LoadConfig()
	require.NoError(t, err)

	assert.Equal(t, ":9999", c.HTTPAddr)
	assert.Equal(t, testSecret, c.JWTSecret)
	assert.Equal(t, 12*time.Hour, c.JWTExpiry)
	assert.Equal(t, []string{"http://localhost:3000", "http://localhost:5173"}, c.CORSAllowedOrigins)
}

func TestLoadConfig_DefaultValues(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://test:test@localhost:5432/test?sslmode=disable")
	t.Setenv("JWT_SECRET", testSecret)

	c, err := LoadConfig()
	require.NoError(t, err)
	assert.Equal(t, "development", c.Env)
	assert.Equal(t, ":8080", c.HTTPAddr)
	assert.Equal(t, 24*time.Hour, c.JWTExpiry)
	assert.Equal(t, "Asia/Jakarta", c.TZ)
}

func TestLoadConfig_MissingRequired(t *testing.T) {
	t.Chdir(t.TempDir())
	require.NoError(t, os.Unsetenv("DATABASE_URL"))
	require.NoError(t, os.Unsetenv("JWT_SECRET"))
	_, err := LoadConfig()
	require.Error(t, err)
}

func TestLoadConfig_BadJWTExpiry(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("JWT_SECRET", testSecret)
	t.Setenv("JWT_EXPIRY", "not-a-duration")
	_, err := LoadConfig()
	require.Error(t, err)
}

func TestLoadConfig_ShortJWTSecretRejected(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("JWT_SECRET", "too-short")
	_, err := LoadConfig()
	require.Error(t, err)
}

func TestLoadConfig_ProductionRejectsWeakDefaults(t *testing.T) {
	base := func() {
		t.Setenv("DATABASE_URL", "postgres://x")
		t.Setenv("JWT_SECRET", testSecret)
		t.Setenv("ENV", "production")
		t.Setenv("MINIO_ACCESS_KEY", "real-access-key")
		t.Setenv("MINIO_SECRET_KEY", "real-secret-key")
	}

	t.Run("empty superadmin password", func(t *testing.T) {
		base()
		t.Setenv("SUPERADMIN_PASSWORD", "")
		t.Setenv("CORS_ALLOWED_ORIGINS", "https://app.example.com")
		_, err := LoadConfig()
		require.Error(t, err)
	})

	t.Run("wildcard CORS", func(t *testing.T) {
		base()
		t.Setenv("SUPERADMIN_PASSWORD", "a-real-password")
		t.Setenv("CORS_ALLOWED_ORIGINS", "*")
		_, err := LoadConfig()
		require.Error(t, err)
	})

	t.Run("vendor-default minio credentials", func(t *testing.T) {
		base()
		t.Setenv("SUPERADMIN_PASSWORD", "a-real-password")
		t.Setenv("CORS_ALLOWED_ORIGINS", "https://app.example.com")
		t.Setenv("MINIO_ACCESS_KEY", "minioadmin")
		_, err := LoadConfig()
		require.Error(t, err)
	})

	t.Run("empty minio credentials", func(t *testing.T) {
		base()
		t.Setenv("SUPERADMIN_PASSWORD", "a-real-password")
		t.Setenv("CORS_ALLOWED_ORIGINS", "https://app.example.com")
		t.Setenv("MINIO_SECRET_KEY", "")
		_, err := LoadConfig()
		require.Error(t, err)
	})

	t.Run("placeholder database password", func(t *testing.T) {
		base()
		t.Setenv("SUPERADMIN_PASSWORD", "a-real-password")
		t.Setenv("CORS_ALLOWED_ORIGINS", "https://app.example.com")
		t.Setenv("DATABASE_URL", "postgres://user:change_me@db:5432/gns")
		_, err := LoadConfig()
		require.Error(t, err)
	})

	t.Run("valid production config", func(t *testing.T) {
		base()
		t.Setenv("SUPERADMIN_PASSWORD", "a-real-password")
		t.Setenv("CORS_ALLOWED_ORIGINS", "https://app.example.com")
		_, err := LoadConfig()
		require.NoError(t, err)
	})
}
