package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

var (
	ErrNotConfigured  = errors.New("storage: minio not configured")
	ErrObjectNotFound = errors.New("storage: object not found")
)

type Client struct {
	mc *minio.Client
}

type Config struct {
	Endpoint  string
	AccessKey string
	SecretKey string
	UseSSL    bool
}

// New connects and ensures buckets.
// Every bucket in AllBuckets must exist; it fails fast on the first
// bucket-creation error.
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

// PutObject streams an object in.
// It runs server-side, on the internal network.
func (c *Client) PutObject(ctx context.Context, bucket, objectKey string, r io.Reader, size int64, contentType string) error {
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	_, err := c.mc.PutObject(ctx, bucket, objectKey, r, size, minio.PutObjectOptions{ContentType: contentType})
	if err != nil {
		return fmt.Errorf("storage: put object: %w", err)
	}
	return nil
}

// GetObject opens an object stream.
// It streams back to the client. Caller closes.
func (c *Client) GetObject(ctx context.Context, bucket, objectKey string) (io.ReadCloser, string, int64, error) {
	obj, err := c.mc.GetObject(ctx, bucket, objectKey, minio.GetObjectOptions{})
	if err != nil {
		return nil, "", 0, fmt.Errorf("storage: get object: %w", err)
	}
	info, err := obj.Stat()
	if err != nil {
		_ = obj.Close()
		if minio.ToErrorResponse(err).Code == "NoSuchKey" {
			return nil, "", 0, ErrObjectNotFound
		}
		return nil, "", 0, fmt.Errorf("storage: stat object: %w", err)
	}
	return obj, info.ContentType, info.Size, nil
}

// ObjectExists reports stored keys.
// The proxy PUT takes its key from the client, so it has to know whether a
// write would replace an existing object rather than create one.
func (c *Client) ObjectExists(ctx context.Context, bucket, objectKey string) (bool, error) {
	_, err := c.mc.StatObject(ctx, bucket, objectKey, minio.StatObjectOptions{})
	if err == nil {
		return true, nil
	}
	switch minio.ToErrorResponse(err).Code {
	case "NoSuchKey", "NoSuchBucket":
		return false, nil
	}
	return false, fmt.Errorf("storage: stat %q/%q: %w", bucket, objectKey, err)
}

// objectPath builds the proxy path.
// The path is API-relative. Uploads and downloads go through the
// authenticated API, so MinIO needs no public host.
func objectPath(bucket, objectKey string) string {
	v := url.Values{}
	v.Set("bucket", bucket)
	v.Set("key", objectKey)
	return "/storage/object?" + v.Encode()
}

// PresignPut returns the upload path.
// The browser PUTs the asset to this proxy path.
func (c *Client) PresignPut(_ context.Context, bucket, objectKey string, _ time.Duration) string {
	return objectPath(bucket, objectKey)
}

// PresignGet returns the download path.
// The browser GETs the asset from this proxy path.
func (c *Client) PresignGet(_ context.Context, bucket, objectKey string, _ time.Duration) string {
	return objectPath(bucket, objectKey)
}

// ObjectInfo is sweeper-relevant metadata.
// It is the subset of MinIO metadata the orphan-blob sweeper uses.
type ObjectInfo struct {
	Key          string
	LastModified time.Time
	Size         int64
}

// ListObjects lists every bucket key.
// It walks recursively and returns the full slice: orphan cleanup is a
// low-frequency batch job and total key counts stay small (one key per row of
// clients/vendors/items/POs/invoices).
func (c *Client) ListObjects(ctx context.Context, bucket string) ([]ObjectInfo, error) {
	var out []ObjectInfo
	for obj := range c.mc.ListObjects(ctx, bucket, minio.ListObjectsOptions{Recursive: true}) {
		if obj.Err != nil {
			return nil, fmt.Errorf("storage: list %q: %w", bucket, obj.Err)
		}
		out = append(out, ObjectInfo{
			Key:          obj.Key,
			LastModified: obj.LastModified,
			Size:         obj.Size,
		})
	}
	return out, nil
}

// RemoveObject deletes one key.
// Idempotent: MinIO treats missing keys as a successful delete.
func (c *Client) RemoveObject(ctx context.Context, bucket, key string) error {
	if err := c.mc.RemoveObject(ctx, bucket, key, minio.RemoveObjectOptions{}); err != nil {
		return fmt.Errorf("storage: remove %q/%q: %w", bucket, key, err)
	}
	return nil
}

// BuildObjectKey stamps a prefixed key.
// Example: BuildObjectKey("po", 42, "scan.pdf") -> "po/42/<unix>-scan.pdf".
func BuildObjectKey(prefix string, id int64, fileName string) string {
	return BuildFolderKey(OwnerFolder(prefix, id, ""), fileName)
}

// OwnerFolder is a record's folder.
// sub names a sub-folder, so two assets of one record never share a folder.
// Example: OwnerFolder("invoices", 7, "payment") -> "invoices/7/payment/".
func OwnerFolder(prefix string, id int64, sub string) string {
	return path.Join(prefix, strconv.FormatInt(id, 10), sub) + "/"
}

// BuildFolderKey stamps a folder key.
func BuildFolderKey(folder, fileName string) string {
	return folder + fmt.Sprintf("%d-%s", time.Now().UTC().Unix(), sanitizeFileName(fileName))
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
