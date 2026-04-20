package app

import (
	"time"

	"github.com/caarlos0/env/v11"
)

type Config struct {
	Env         string        `env:"ENV" envDefault:"development"`
	HTTPAddr    string        `env:"HTTP_ADDR" envDefault:":8080"`
	DatabaseURL string        `env:"DATABASE_URL,required"`
	JWTSecret   string        `env:"JWT_SECRET,required"`
	JWTExpiry   time.Duration `env:"JWT_EXPIRY" envDefault:"24h"`

	MinioEndpoint  string `env:"MINIO_ENDPOINT" envDefault:"minio:9000"`
	MinioAccessKey string `env:"MINIO_ACCESS_KEY"`
	MinioSecretKey string `env:"MINIO_SECRET_KEY"`
	MinioBucket    string `env:"MINIO_BUCKET" envDefault:"internalgns"`
	MinioUseSSL    bool   `env:"MINIO_USE_SSL" envDefault:"false"`

	TZ string `env:"TZ" envDefault:"Asia/Jakarta"`
}

func LoadConfig() (Config, error) {
	var c Config
	if err := env.Parse(&c); err != nil {
		return Config{}, err
	}
	return c, nil
}
