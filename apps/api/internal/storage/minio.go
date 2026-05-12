package storage

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

var ErrNotConfigured = errors.New("storage: minio not configured")

type Client struct {
	mc *minio.Client
}

type Config struct {
	Endpoint  string
	AccessKey string
	SecretKey string
	UseSSL    bool
}

// New initializes the MinIO client and ensures every bucket in AllBuckets
// exists. Fails fast on the first bucket-creation error.
func New(ctx context.Context, cfg Config) (*Client, error) {
	if cfg.AccessKey == "" || cfg.SecretKey == "" {
		return nil, ErrNotConfigured
	}
	mc, err := minio.New(cfg.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: cfg.UseSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("storage: new client: %w", err)
	}
	for _, b := range AllBuckets {
		exists, err := mc.BucketExists(ctx, b)
		if err != nil {
			return nil, fmt.Errorf("storage: bucket exists check %q: %w", b, err)
		}
		if exists {
			continue
		}
		if err := mc.MakeBucket(ctx, b, minio.MakeBucketOptions{}); err != nil {
			return nil, fmt.Errorf("storage: make bucket %q: %w", b, err)
		}
	}
	return &Client{mc: mc}, nil
}

// PresignPut returns a presigned PUT URL valid for expiry.
func (c *Client) PresignPut(ctx context.Context, bucket, objectKey string, expiry time.Duration) (string, error) {
	u, err := c.mc.PresignedPutObject(ctx, bucket, objectKey, expiry)
	if err != nil {
		return "", fmt.Errorf("storage: presign put: %w", err)
	}
	return u.String(), nil
}

// PresignGet returns a presigned GET URL valid for expiry.
func (c *Client) PresignGet(ctx context.Context, bucket, objectKey string, expiry time.Duration) (string, error) {
	u, err := c.mc.PresignedGetObject(ctx, bucket, objectKey, expiry, url.Values{})
	if err != nil {
		return "", fmt.Errorf("storage: presign get: %w", err)
	}
	return u.String(), nil
}

// BuildObjectKey returns a deterministic key under a namespace prefix.
// Example: BuildObjectKey("po", 42, "scan.pdf") -> "po/42/<unix>-scan.pdf".
func BuildObjectKey(prefix string, id int64, fileName string) string {
	name := sanitizeFileName(fileName)
	stamp := time.Now().UTC().Unix()
	return path.Join(prefix, fmt.Sprintf("%d", id), fmt.Sprintf("%d-%s", stamp, name))
}

func sanitizeFileName(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "file"
	}
	// Strip any path separators a client might inject.
	s = strings.ReplaceAll(s, "\\", "/")
	s = path.Base(s)
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z',
			r >= 'A' && r <= 'Z',
			r >= '0' && r <= '9',
			r == '.', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	out := b.String()
	if out == "" {
		return "file"
	}
	return out
}
