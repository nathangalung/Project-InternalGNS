package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/storage"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

func NewServer(ctx context.Context, cfg Config) (*http.Server, error) {
	pool, err := db.NewPool(ctx, cfg.DatabaseURL, cfg.TZ)
	if err != nil {
		return nil, err
	}
	// Fail fast if the session zone did not take: every date-derived value
	// (invoice_date, document numbers) depends on it.
	if cfg.TZ != "" {
		var sessionTZ string
		if err := pool.QueryRow(ctx, "SHOW timezone").Scan(&sessionTZ); err != nil {
			pool.Close()
			return nil, err
		}
		if sessionTZ != cfg.TZ {
			pool.Close()
			return nil, fmt.Errorf("db session timezone is %q, want %q", sessionTZ, cfg.TZ)
		}
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
		Endpoint:  cfg.MinioEndpoint,
		AccessKey: cfg.MinioAccessKey,
		SecretKey: cfg.MinioSecretKey,
		UseSSL:    cfg.MinioUseSSL,
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
