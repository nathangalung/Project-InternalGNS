package app

import (
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadConfig_HappyPath(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://test:test@localhost:5432/test?sslmode=disable")
	t.Setenv("JWT_SECRET", "topsecret")
	t.Setenv("JWT_EXPIRY", "12h")
	t.Setenv("HTTP_ADDR", ":9999")
	t.Setenv("CORS_ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173")

	c, err := LoadConfig()
	require.NoError(t, err)

	assert.Equal(t, ":9999", c.HTTPAddr)
	assert.Equal(t, "topsecret", c.JWTSecret)
	assert.Equal(t, 12*time.Hour, c.JWTExpiry)
	assert.Equal(t, []string{"http://localhost:3000", "http://localhost:5173"}, c.CORSAllowedOrigins)
}

func TestLoadConfig_DefaultValues(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://test:test@localhost:5432/test?sslmode=disable")
	t.Setenv("JWT_SECRET", "topsecret")

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
	t.Setenv("JWT_SECRET", "x")
	t.Setenv("JWT_EXPIRY", "not-a-duration")
	_, err := LoadConfig()
	require.Error(t, err)
}
