package app

import (
	"errors"
	"io/fs"
	"log/slog"
	"strings"
	"time"

	"github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"
)

type Config struct {
	Env                string        `env:"ENV"           envDefault:"development"`
	LogLevel           string        `env:"LOG_LEVEL"     envDefault:"info"`
	HTTPAddr           string        `env:"HTTP_ADDR"     envDefault:":8080"`
	DatabaseURL        string        `env:"DATABASE_URL,required"`
	JWTSecret          string        `env:"JWT_SECRET,required,notEmpty"`
	JWTExpiry          time.Duration `env:"JWT_EXPIRY"           envDefault:"24h"`
	RefreshTokenExpiry time.Duration `env:"REFRESH_TOKEN_EXPIRY" envDefault:"720h"`

	CORSAllowedOrigins []string `env:"CORS_ALLOWED_ORIGINS" envDefault:"*" envSeparator:","`

	SuperadminEmail    string `env:"SUPERADMIN_EMAIL"    envDefault:"admin@globalsakti.com"`
	SuperadminName     string `env:"SUPERADMIN_NAME"     envDefault:"Administrator"`
	SuperadminPassword string `env:"SUPERADMIN_PASSWORD"`

	// Optional second superadmin. Seeded on boot only if EMAIL + PASSWORD
	// are both non-empty; otherwise skipped silently. SeedSuperadmin is
	// idempotent — re-running with the same email is a no-op.
	Superadmin2Email    string `env:"SUPERADMIN2_EMAIL"`
	Superadmin2Name     string `env:"SUPERADMIN2_NAME"     envDefault:"Administrator 2"`
	Superadmin2Password string `env:"SUPERADMIN2_PASSWORD"`

	MinioEndpoint  string `env:"MINIO_ENDPOINT"   envDefault:"minio:9000"`
	MinioAccessKey string `env:"MINIO_ACCESS_KEY"`
	MinioSecretKey string `env:"MINIO_SECRET_KEY"`
	MinioUseSSL    bool   `env:"MINIO_USE_SSL"    envDefault:"false"`

	TZ string `env:"TZ" envDefault:"Asia/Jakarta"`

	TemplatesRoot string `env:"TEMPLATES_ROOT" envDefault:"templates/documents"`

	PdfSignerName    string `env:"PDF_SIGNER_NAME"     envDefault:"Director"`
	PdfBankName      string `env:"PDF_BANK_NAME"       envDefault:"BCA"`
	PdfBankAccountNo string `env:"PDF_BANK_ACCOUNT_NO" envDefault:"-"`
	PdfBankAccountNm string `env:"PDF_BANK_ACCOUNT_NM" envDefault:"PT GLOBAL NIAGA SAKTI"`
	PdfPaymentTerms  string `env:"PDF_PAYMENT_TERMS"   envDefault:"Net 30 days"`

	// Coretax (DJP) e-faktur export: seller-side static fields. SellerTIN is
	// the company NPWP (16 digits, no separators); SellerIDTKU appends the
	// branch suffix ("000000" for headquarters).
	CoretaxSellerTIN   string `env:"CORETAX_SELLER_TIN"   envDefault:""`
	CoretaxSellerIDTKU string `env:"CORETAX_SELLER_IDTKU" envDefault:""`
}

func LoadConfig() (Config, error) {
	if err := godotenv.Load(); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return Config{}, err
	}
	var c Config
	if err := env.Parse(&c); err != nil {
		return Config{}, err
	}
	if err := c.validate(); err != nil {
		return Config{}, err
	}
	return c, nil
}

// validate rejects fail-open configuration.
func (c Config) validate() error {
	// A short HMAC key is trivially brute-forced; reject empty or weak keys.
	if len(c.JWTSecret) < 32 {
		return errors.New("JWT_SECRET must be at least 32 bytes")
	}
	// Length alone does not make a secret. The value shipped in
	// .env.prod.example is 33 characters, so it clears the check above while
	// being published in the repository: anyone could sign a token for any user
	// and role. Reject it everywhere, not just in production, because a staging
	// box reachable from the internet is just as forgeable.
	if isPlaceholder(c.JWTSecret) {
		return errors.New("JWT_SECRET is still the placeholder from .env.prod.example; generate one with openssl rand -hex 32")
	}
	if c.Env == "production" {
		if c.SuperadminPassword == "" {
			return errors.New("SUPERADMIN_PASSWORD is required in production")
		}
		if isPlaceholder(c.SuperadminPassword) || isPlaceholder(c.Superadmin2Password) {
			return errors.New("SUPERADMIN_PASSWORD/SUPERADMIN2_PASSWORD is still a placeholder in production")
		}
		for _, o := range c.CORSAllowedOrigins {
			if o == "*" {
				return errors.New("CORS_ALLOWED_ORIGINS must not be * in production")
			}
		}
		// Fail closed on shipped placeholder / vendor-default credentials.
		// Empty is left alone: it is the deliberate "storage disabled" signal
		// (server.go boots with a nil storage client), not a weak secret.
		if isWeakCred(c.MinioAccessKey) || isWeakCred(c.MinioSecretKey) {
			return errors.New("MINIO_ACCESS_KEY/MINIO_SECRET_KEY must not be a placeholder or vendor default in production")
		}
		if isPlaceholder(c.DatabaseURL) {
			return errors.New("DATABASE_URL still contains a placeholder password in production")
		}
	}
	return nil
}

// isWeakCred flags vendor-default or unreplaced-placeholder secrets. Empty is
// NOT weak — it is the supported "storage disabled" signal.
func isWeakCred(v string) bool {
	if strings.EqualFold(strings.TrimSpace(v), "minioadmin") {
		return true
	}
	return isPlaceholder(v)
}

// Markers that only ever appear in template values.
var placeholderMarkers = []string{
	"change_me", "changeme", "generate_with", "placeholder",
	"before_deploy", "yourdomain", "your-domain", "replace_me",
}

// isPlaceholder reports an unreplaced template value. Matching on markers
// rather than a fixed list keeps it working when the template text changes; a
// real random secret contains none of them. Empty is not a placeholder, since
// some settings treat it as a deliberate "disabled" signal.
func isPlaceholder(v string) bool {
	s := strings.ToLower(strings.TrimSpace(v))
	if s == "" {
		return false
	}
	for _, m := range placeholderMarkers {
		if strings.Contains(s, m) {
			return true
		}
	}
	return false
}

// SlogLevel maps LOG_LEVEL to a slog level, defaulting to Info on anything else.
func (c Config) SlogLevel() slog.Level {
	switch strings.ToLower(strings.TrimSpace(c.LogLevel)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
