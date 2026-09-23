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
		t.Setenv("PDF_BANK_ACCOUNT_NO", "1234567890")
		t.Setenv("PDF_SIGNER_NAME", "Nathan Galung")
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

	t.Run("empty minio credentials allowed (storage disabled)", func(t *testing.T) {
		base()
		t.Setenv("SUPERADMIN_PASSWORD", "a-real-password")
		t.Setenv("CORS_ALLOWED_ORIGINS", "https://app.example.com")
		t.Setenv("MINIO_ACCESS_KEY", "")
		t.Setenv("MINIO_SECRET_KEY", "")
		_, err := LoadConfig()
		require.NoError(t, err)
	})

	t.Run("placeholder database password", func(t *testing.T) {
		base()
		t.Setenv("SUPERADMIN_PASSWORD", "a-real-password")
		t.Setenv("CORS_ALLOWED_ORIGINS", "https://app.example.com")
		t.Setenv("DATABASE_URL", "postgres://user:change_me@db:5432/gns")
		_, err := LoadConfig()
		require.Error(t, err)
	})

	// The shipped JWT_SECRET is 33 chars, so it clears the length check while
	// being published in the repo. Anyone could forge a superadmin token.
	t.Run("shipped placeholder jwt secret", func(t *testing.T) {
		base()
		t.Setenv("JWT_SECRET", "generate_with_openssl_rand_hex_32")
		t.Setenv("SUPERADMIN_PASSWORD", "a-real-password")
		t.Setenv("CORS_ALLOWED_ORIGINS", "https://app.example.com")
		_, err := LoadConfig()
		require.Error(t, err)
	})

	t.Run("shipped placeholder superadmin password", func(t *testing.T) {
		base()
		t.Setenv("SUPERADMIN_PASSWORD", "CHANGE_ME_before_deploy")
		t.Setenv("CORS_ALLOWED_ORIGINS", "https://app.example.com")
		_, err := LoadConfig()
		require.Error(t, err)
	})

	// A client would be asked to transfer money into a dash.
	t.Run("default bank account number", func(t *testing.T) {
		base()
		t.Setenv("SUPERADMIN_PASSWORD", "a-real-password")
		t.Setenv("CORS_ALLOWED_ORIGINS", "https://app.example.com")
		t.Setenv("PDF_BANK_ACCOUNT_NO", "-")
		_, err := LoadConfig()
		require.Error(t, err)
	})

	t.Run("placeholder bank account number", func(t *testing.T) {
		base()
		t.Setenv("SUPERADMIN_PASSWORD", "a-real-password")
		t.Setenv("CORS_ALLOWED_ORIGINS", "https://app.example.com")
		t.Setenv("PDF_BANK_ACCOUNT_NO", "CHANGE_ME")
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

// compose.dev.yml is committed, so the secrets it sets are public. A
// production boot must refuse them however well-formed they look.
func TestConfig_ProductionRejectsCommittedDevSecrets(t *testing.T) {
	const devJWT = "local_dev_only_jwt_signing_key_0123456789abcdef"
	const devPassword = "AdminGNS123!"

	prod := func() Config {
		return Config{
			Env:                 "production",
			JWTSecret:           testSecret,
			DatabaseURL:         "postgres://u:p@db:5432/gns",
			CORSAllowedOrigins:  []string{"https://app.example"},
			SuperadminPassword:  "a-real-generated-password",
			Superadmin2Password: "",
			PdfBankAccountNo:    "1234567890",
			PdfSignerName:       "Budi",
		}
	}

	cases := []struct {
		name    string
		mutate  func(*Config)
		wantErr bool
	}{
		{"baseline is accepted", func(*Config) {}, false},
		{"dev jwt secret", func(c *Config) { c.JWTSecret = devJWT }, true},
		{"dev superadmin password", func(c *Config) { c.SuperadminPassword = devPassword }, true},
		{"dev second superadmin password", func(c *Config) { c.Superadmin2Password = devPassword }, true},
		{"dev jwt secret with surrounding space", func(c *Config) { c.JWTSecret = " " + devJWT + " " }, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := prod()
			tc.mutate(&c)
			err := c.validate()
			if tc.wantErr {
				require.Error(t, err)
				return
			}
			assert.NoError(t, err)
		})
	}
}

// The same values must keep working outside production: compose.dev.yml sets
// them, so rejecting them everywhere would stop `make dev` booting.
func TestConfig_DevelopmentAcceptsCommittedDevSecrets(t *testing.T) {
	c := Config{
		Env:                "development",
		JWTSecret:          "local_dev_only_jwt_signing_key_0123456789abcdef",
		DatabaseURL:        "postgres://gns_app:gns_app@postgres:5432/gns_quotation",
		SuperadminPassword: "AdminGNS123!",
	}
	assert.NoError(t, c.validate())
}

// Every production check keys on ENV == "production", so a near miss such
// as "prod" or "Production" used to boot with all of them skipped: the dev
// secrets, a wildcard CORS origin and a "-" bank account all passed. An
// unrecognised ENV now refuses to boot instead of failing open.
func TestConfig_UnknownEnvFailsClosed(t *testing.T) {
	cases := []struct {
		env     string
		wantErr bool
	}{
		{"development", false},
		{"test", false},
		{"production", false},
		{"prod", true},
		{"Production", true},
		{"production ", true},
		{"staging", true},
		{"", true},
	}
	for _, tc := range cases {
		t.Run(tc.env, func(t *testing.T) {
			c := Config{
				Env:                tc.env,
				JWTSecret:          testSecret,
				DatabaseURL:        "postgres://u:p@db:5432/gns",
				CORSAllowedOrigins: []string{"https://app.example"},
				SuperadminPassword: "a-real-generated-password",
				PdfBankAccountNo:   "1234567890",
				PdfSignerName:      "Budi",
			}
			err := c.validate()
			if tc.wantErr {
				require.Error(t, err)
				assert.Contains(t, err.Error(), "ENV")
				return
			}
			assert.NoError(t, err)
		})
	}
}
