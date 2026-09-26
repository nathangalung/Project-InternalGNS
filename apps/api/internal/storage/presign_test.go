package storage

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// Presign returns the proxy path.
// The path is API-relative, with no public MinIO host.
func TestPresign_ReturnsProxyPath(t *testing.T) {
	c := &Client{}
	u := c.PresignPut(context.Background(), BucketPODocs, "po/1/scan.pdf", time.Minute)
	const want = "/storage/object?bucket=po-docs&key=po%2F1%2Fscan.pdf"
	if u != want {
		t.Fatalf("PresignPut = %q, want %q", u, want)
	}
	// Uploads and downloads share the one proxy route.
	g := c.PresignGet(context.Background(), BucketPODocs, "po/1/scan.pdf", time.Minute)
	if g != want {
		t.Fatalf("PresignGet = %q, want %q", g, want)
	}
}

// safeKey allows consecutive dots.
// It still blocks path traversal (the ".." segment).
func TestSafeKey(t *testing.T) {
	cases := []struct {
		key  string
		want bool
	}{
		{"invoices/7/1700-report..final.pdf", true},
		{"po/1/scan.pdf", true},
		{"a..b/c.png", true},
		{"", false},
		{"/abs/key.png", false},
		{"../etc/passwd", false},
		{"po/../../etc/passwd", false},
		{"a/./b", false},
	}
	for _, c := range cases {
		if got := safeKey(c.key); got != c.want {
			t.Errorf("safeKey(%q) = %v, want %v", c.key, got, c.want)
		}
	}
}

// Proxy rejects bad input early.
// Unknown buckets and traversal keys fail before MinIO is touched.
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
