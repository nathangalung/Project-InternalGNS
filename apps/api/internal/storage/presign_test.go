package storage

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// Presign now returns the API-relative proxy path (no public MinIO host).
func TestPresign_ReturnsProxyPath(t *testing.T) {
	c := &Client{}
	u, err := c.PresignPut(context.Background(), "po-files", "po/1/scan.pdf", time.Minute)
	if err != nil {
		t.Fatalf("presign put: %v", err)
	}
	const want = "/storage/object?bucket=po-files&key=po%2F1%2Fscan.pdf"
	if u != want {
		t.Fatalf("PresignPut = %q, want %q", u, want)
	}
}

// The proxy rejects unknown buckets and traversal keys before touching MinIO.
func TestHandler_RejectsBadInput(t *testing.T) {
	h := NewHandler(nil)
	cases := []struct{ name, q string }{
		{"unknown bucket", "?bucket=evil&key=a.png"},
		{"traversal key", "?bucket=" + AllBuckets[0] + "&key=../etc/passwd"},
		{"empty key", "?bucket=" + AllBuckets[0] + "&key="},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.Get(rec, httptest.NewRequest(http.MethodGet, "/storage/object"+c.q, nil))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("want 400, got %d", rec.Code)
			}
		})
	}
}
