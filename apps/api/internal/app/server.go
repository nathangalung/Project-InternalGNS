package app

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/storage"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

func NewServer(ctx context.Context, cfg Config) (*http.Server, error) {
	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, err
	}
	if err := db.RunMigrations(ctx, pool); err != nil {
		return nil, err
	}
	if err := users.SeedSuperadmin(ctx, pool, users.SeedConfig{
		Email:    cfg.SuperadminEmail,
		Name:     cfg.SuperadminName,
		Password: cfg.SuperadminPassword,
	}); err != nil {
		return nil, err
	}
	if cfg.Superadmin2Email != "" && cfg.Superadmin2Password != "" {
		if err := users.SeedSuperadmin(ctx, pool, users.SeedConfig{
			Email:    cfg.Superadmin2Email,
			Name:     cfg.Superadmin2Name,
			Password: cfg.Superadmin2Password,
		}); err != nil {
			return nil, err
		}
	}

	store, err := queries.Load()
	if err != nil {
		return nil, err
	}

	storageClient, err := storage.New(ctx, storage.Config{
		Endpoint:       cfg.MinioEndpoint,
		AccessKey:      cfg.MinioAccessKey,
		SecretKey:      cfg.MinioSecretKey,
		UseSSL:         cfg.MinioUseSSL,
		PublicEndpoint: cfg.MinioPublicEndpoint,
		PublicUseSSL:   cfg.MinioPublicUseSSL,
	})
	if err != nil {
		if errors.Is(err, storage.ErrNotConfigured) {
			slog.Warn("storage disabled (missing MINIO_ACCESS_KEY/SECRET_KEY)")
			storageClient = nil
		} else {
			return nil, err
		}
	}

	r := NewRouter(cfg, pool, store, storageClient)

	return &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}, nil
}
