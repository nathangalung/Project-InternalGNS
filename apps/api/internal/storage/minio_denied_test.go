package storage

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// A refused store call is a fault, not an absence.
// Every client call against a store that rejects the credentials must fail
// with the step named, so the proxy answers 502 instead of treating the key
// as free or the object as missing.
func TestClient_DeniedCallsFail(t *testing.T) {
	endpoint := os.Getenv("MINIO_ENDPOINT")
	if endpoint == "" {
		t.Skip("MINIO_ENDPOINT not set; skipping MinIO integration test")
	}
	mc, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4("gns-denied", "gns-denied-secret", ""),
		Secure: os.Getenv("MINIO_USE_SSL") == "true",
	})
	if err != nil {
		t.Fatalf("minio client: %v", err)
	}
	c := &Client{mc: mc}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	const key = "po/1/1-denied.pdf"

	cases := []struct {
		name string
		call func() error
		want string
	}{
		{"exists probe", func() error {
			exists, err := c.ObjectExists(ctx, BucketPODocs, key)
			if exists {
				t.Error("a denied probe reported the key as taken")
			}
			return err
		}, "storage: stat"},
		{"download", func() error {
			_, _, _, err := c.GetObject(ctx, BucketPODocs, key)
			return err
		}, "storage: stat object"},
		{"upload", func() error {
			return c.PutObject(ctx, BucketPODocs, key, strings.NewReader("x"), 1, "application/pdf")
		}, "storage: put object"},
		{"remove", func() error { return c.RemoveObject(ctx, BucketPODocs, key) }, "storage: remove"},
		{"list", func() error {
			_, err := c.ListObjects(ctx, BucketPODocs)
			return err
		}, "storage: list"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.call()
			if err == nil {
				t.Fatal("want an error from a store that refuses the credentials")
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error %q does not name %q", err, tc.want)
			}
			if err == ErrObjectNotFound {
				t.Fatal("a denied call must not read as a missing object")
			}
		})
	}
}
