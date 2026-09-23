package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/storage"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

// Server owns the HTTP server and its pool.
// The pool outlives every in-flight request, so releasing it is the caller's
// last act after Shutdown returns, not something http.Server can do.
type Server struct {
	HTTP      *http.Server
	pool      *pgxpool.Pool
	stopPurge context.CancelFunc
	purgeDone chan struct{}
}

// Close stops the purge, then releases the pool.
// The sweep is joined first: a sweep that started after pool.Close logged
// "closed pool" on every bootstrap run. Safe to call more than once: cancel
// is idempotent, a closed channel never blocks, and pgxpool.Close is guarded
// by a sync.Once.
func (s *Server) Close() {
	if s == nil {
		return
	}
	if s.stopPurge != nil {
		s.stopPurge()
		<-s.purgeDone
	}
	if s.pool != nil {
		s.pool.Close()
	}
}

// NewServer opens the pool and wires the server.
// Every failure after the pool is open closes it on the way out, so a failed
// boot leaves no connections behind.
func NewServer(ctx context.Context, cfg Config) (*Server, error) {
	pool, err := db.NewPool(ctx, cfg.DatabaseURL, cfg.TZ)
	if err != nil {
		return nil, fmt.Errorf("open pool: %w", err)
	}
	httpSrv, store, err := buildServer(ctx, cfg, pool)
	if err != nil {
		pool.Close()
		return nil, err
	}
	s := &Server{HTTP: httpSrv, pool: pool, purgeDone: make(chan struct{})}
	// A child of ctx, so SIGTERM still stops the sweep, while Close can stop
	// and join it before the pool goes away.
	purgeCtx, cancel := context.WithCancel(ctx)
	s.stopPurge = cancel
	go func() {
		defer close(s.purgeDone)
		runRefreshPurgeLoop(purgeCtx, auth.NewRefreshRepo(pool, store), refreshPurgeInterval)
	}()
	return s, nil
}

// buildServer wires migrations, seeds and routes.
// The store is returned for the purge NewServer starts.
func buildServer(ctx context.Context, cfg Config, pool *pgxpool.Pool) (*http.Server, queries.Store, error) {
	// Fail fast if the session zone did not take: every date-derived value
	// (invoice_date, document numbers) depends on it.
	if cfg.TZ != "" {
		var sessionTZ string
		if err := pool.QueryRow(ctx, "SHOW timezone").Scan(&sessionTZ); err != nil {
			return nil, nil, fmt.Errorf("read db session timezone: %w", err)
		}
		if sessionTZ != cfg.TZ {
			return nil, nil, fmt.Errorf("db session timezone is %q, want %q", sessionTZ, cfg.TZ)
		}
	}
	if err := db.RunMigrations(ctx, pool); err != nil {
		return nil, nil, fmt.Errorf("run migrations: %w", err)
	}
	if err := users.SeedSuperadmin(ctx, pool, users.SeedConfig{
		Email:    cfg.SuperadminEmail,
		Name:     cfg.SuperadminName,
		Password: cfg.SuperadminPassword,
	}); err != nil {
		return nil, nil, fmt.Errorf("seed superadmin: %w", err)
	}
	if cfg.Superadmin2Email != "" && cfg.Superadmin2Password != "" {
		if err := users.SeedSuperadmin(ctx, pool, users.SeedConfig{
			Email:    cfg.Superadmin2Email,
			Name:     cfg.Superadmin2Name,
			Password: cfg.Superadmin2Password,
		}); err != nil {
			return nil, nil, fmt.Errorf("seed second superadmin: %w", err)
		}
	}

	store, err := queries.Load()
	if err != nil {
		return nil, nil, fmt.Errorf("load queries: %w", err)
	}

	storageClient, err := storage.New(ctx, storage.Config{
		Endpoint:  cfg.MinioEndpoint,
		AccessKey: cfg.MinioAccessKey,
		SecretKey: cfg.MinioSecretKey,
		UseSSL:    cfg.MinioUseSSL,
	})
	if err != nil {
		if errors.Is(err, storage.ErrNotConfigured) {
			slog.WarnContext(ctx, "storage disabled (missing MINIO_ACCESS_KEY/SECRET_KEY)")
			storageClient = nil
		} else {
			return nil, nil, fmt.Errorf("init storage: %w", err)
		}
	}

	r := NewRouter(cfg, pool, store, storageClient)

	return &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		// Above renderRequestTimeout (60s) so the handler deadline fires first
		// and renders 503 + Retry-After, instead of the connection being cut.
		WriteTimeout: 90 * time.Second,
		IdleTimeout:  120 * time.Second,
	}, store, nil
}
