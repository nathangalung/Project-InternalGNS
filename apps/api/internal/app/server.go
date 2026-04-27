package app

import (
	"context"
	"net/http"
	"time"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
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

	store, err := queries.Load()
	if err != nil {
		return nil, err
	}

	r := NewRouter(cfg, pool, store)

	return &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}, nil
}
