// orphan-blobs sweeps MinIO keys not referenced by any DB row.
// Use --dry-run (default true) to list orphans without deleting.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nathangalung/internalgns/apps/api/internal/app"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/storage"
)

type bucketSpec struct {
	bucket string
	query  string
}

// Each bucket maps to a single DB column referencing object keys.
var specs = []bucketSpec{
	{storage.BucketPODocs, "SELECT file_url FROM purchase_orders WHERE file_url IS NOT NULL"},
	{storage.BucketClientLogos, "SELECT logo_object_key FROM company_client WHERE logo_object_key IS NOT NULL"},
	{storage.BucketVendorLogos, "SELECT logo_object_key FROM vendors WHERE logo_object_key IS NOT NULL"},
	{storage.BucketItemImages, "SELECT image_object_key FROM items WHERE image_object_key IS NOT NULL"},
	{storage.BucketInvoiceAttachments, "SELECT attachment_object_key FROM invoices WHERE attachment_object_key IS NOT NULL"},
}

func main() {
	dryRun := flag.Bool("dry-run", true, "list orphans without deleting")
	minAgeMinutes := flag.Int("min-age-minutes", 60, "skip MinIO keys newer than this many minutes (safety window for in-flight uploads)")
	bucketFilter := flag.String("bucket", "", "limit to a single bucket name (default: all)")
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	cfg, err := app.LoadConfig()
	if err != nil {
		logger.Error("load config", "err", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("db pool", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	sc, err := storage.New(ctx, storage.Config{
		Endpoint:  cfg.MinioEndpoint,
		AccessKey: cfg.MinioAccessKey,
		SecretKey: cfg.MinioSecretKey,
		UseSSL:    cfg.MinioUseSSL,
	})
	if err != nil {
		if errors.Is(err, storage.ErrNotConfigured) {
			logger.Error("storage not configured (set MINIO_ACCESS_KEY + MINIO_SECRET_KEY)")
		} else {
			logger.Error("storage init", "err", err)
		}
		os.Exit(1)
	}

	cutoff := time.Now().Add(-time.Duration(*minAgeMinutes) * time.Minute)

	var totalOrphans, totalDeleted int
	for _, s := range specs {
		if *bucketFilter != "" && *bucketFilter != s.bucket {
			continue
		}
		orph, del, err := sweepBucket(ctx, pool, sc, s, cutoff, *dryRun, logger)
		if err != nil {
			logger.Error("sweep bucket failed", "bucket", s.bucket, "err", err)
			os.Exit(1)
		}
		totalOrphans += orph
		totalDeleted += del
	}

	logger.Info("sweep complete",
		"dry_run", *dryRun,
		"total_orphans", totalOrphans,
		"total_deleted", totalDeleted,
	)
}

func sweepBucket(
	ctx context.Context,
	pool *pgxpool.Pool,
	sc *storage.Client,
	spec bucketSpec,
	cutoff time.Time,
	dryRun bool,
	logger *slog.Logger,
) (int, int, error) {
	referenced, err := loadReferences(ctx, pool, spec.query)
	if err != nil {
		return 0, 0, fmt.Errorf("load refs: %w", err)
	}

	keys, err := sc.ListObjects(ctx, spec.bucket)
	if err != nil {
		return 0, 0, fmt.Errorf("list bucket: %w", err)
	}

	var orphans []storage.ObjectInfo
	for _, k := range keys {
		if k.LastModified.After(cutoff) {
			continue
		}
		if _, ok := referenced[k.Key]; ok {
			continue
		}
		orphans = append(orphans, k)
	}

	logger.Info("bucket scan",
		"bucket", spec.bucket,
		"listed", len(keys),
		"referenced", len(referenced),
		"orphans", len(orphans),
	)

	if dryRun {
		for _, o := range orphans {
			logger.Info("orphan (dry-run)", "bucket", spec.bucket, "key", o.Key, "size", o.Size, "last_modified", o.LastModified)
		}
		return len(orphans), 0, nil
	}

	deleted := 0
	for _, o := range orphans {
		if err := sc.RemoveObject(ctx, spec.bucket, o.Key); err != nil {
			logger.Error("remove failed", "bucket", spec.bucket, "key", o.Key, "err", err)
			continue
		}
		deleted++
		logger.Info("deleted", "bucket", spec.bucket, "key", o.Key)
	}
	return len(orphans), deleted, nil
}

func loadReferences(ctx context.Context, pool *pgxpool.Pool, query string) (map[string]struct{}, error) {
	rows, err := pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string]struct{})
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		if key != "" {
			out[key] = struct{}{}
		}
	}
	return out, rows.Err()
}
