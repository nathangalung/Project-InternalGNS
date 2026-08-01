package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/nathangalung/internalgns/apps/api/internal/app"
)

func main() {
	bootstrap := flag.Bool("bootstrap", false, "Run migrations + superadmin seed then exit")
	healthcheck := flag.Bool("healthcheck", false, "Probe /readyz on the local server then exit")
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	if *healthcheck {
		os.Exit(probeReadyz())
	}

	cfg, err := app.LoadConfig()
	if err != nil {
		logger.Error("load config", "err", err)
		os.Exit(1)
	}

	// Rebuild at the configured level with request-id stamping now that config loaded.
	logger = app.NewLogger(os.Stdout, cfg.SlogLevel())
	slog.SetDefault(logger)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	srv, err := app.NewServer(ctx, cfg)
	if err != nil {
		logger.Error("build server", "err", err)
		os.Exit(1)
	}

	if *bootstrap {
		logger.Info("bootstrap done")
		return
	}

	go func() {
		logger.Info("listening", "addr", cfg.HTTPAddr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("serve", "err", err)
			stop()
		}
	}()

	<-ctx.Done()
	logger.Info("shutting down")
	// Drain budget must exceed the 30s handler timeout and stay under the
	// compose stop_grace_period (45s). See docker-compose.yml api service.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("shutdown", "err", err)
	}
}

// probeReadyz GETs the local readiness endpoint for the container healthcheck.
// Returns 0 when ready, 1 otherwise, without loading config or the DB.
func probeReadyz() int {
	addr := os.Getenv("HTTP_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	client := &http.Client{Timeout: 3 * time.Second}
	res, err := client.Get("http://localhost" + addr + "/readyz")
	if err != nil {
		return 1
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}
