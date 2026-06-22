package storage

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// Presigned URLs must carry the public host so a browser can reach them.
func TestPresignPut_UsesPublicEndpoint(t *testing.T) {
	pmc, err := minio.New("s3.public.example.com", &minio.Options{
		Creds:  credentials.NewStaticV4("ak", "sk", ""),
		Secure: true,
		Region: "us-east-1",
	})
	if err != nil {
		t.Fatalf("new presign client: %v", err)
	}
	c := &Client{presign: pmc}

	u, err := c.PresignPut(context.Background(), "po-files", "po/1/scan.pdf", time.Minute)
	if err != nil {
		t.Fatalf("presign put: %v", err)
	}
	if !strings.HasPrefix(u, "https://s3.public.example.com/") {
		t.Fatalf("presigned URL not on public host: %q", u)
	}
}
