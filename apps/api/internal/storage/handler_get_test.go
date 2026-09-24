package storage

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

// Serves one stored object.
type objectFake struct {
	fakeStore
	body        string
	contentType string
	missing     bool
	closed      bool
}

func (o *objectFake) GetObject(context.Context, string, string) (io.ReadCloser, string, int64, error) {
	if o.missing {
		return nil, "", 0, ErrObjectNotFound
	}
	return &closeProbe{Reader: strings.NewReader(o.body), closed: &o.closed}, o.contentType, int64(len(o.body)), nil
}

// Records the object close.
type closeProbe struct {
	io.Reader
	closed *bool
}

func (c *closeProbe) Close() error {
	*c.closed = true
	return nil
}

// Downloads are typed attachments.
// The type comes from the allow-listed extension, never from the type the
// uploader stored, so a document cannot run as HTML on the API origin.
func TestHandler_Get(t *testing.T) {
	cases := []struct {
		name            string
		key             string
		store           *objectFake
		wantStatus      int
		wantType        string
		wantDisposition string
	}{
		{"image by extension", "clients/7/1-logo.png",
			&objectFake{body: "png-bytes", contentType: "text/html"},
			http.StatusOK, "image/png", `attachment; filename="1-logo.png"`},
		{"pdf by extension", "po/3/1-scan.PDF",
			&objectFake{body: "%PDF", contentType: "text/html"},
			http.StatusOK, "application/pdf", `attachment; filename="1-scan.PDF"`},
		{"unknown extension", "po/3/1-scan",
			&objectFake{body: "raw", contentType: "text/html"},
			http.StatusOK, "application/octet-stream", `attachment; filename="1-scan"`},
		{"missing object", "clients/7/1-gone.png",
			&objectFake{missing: true},
			http.StatusNotFound, "application/problem+json", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := newHandlerWithStore(tc.store)
			rec := httptest.NewRecorder()
			h.Get(rec, httptest.NewRequest(http.MethodGet,
				"/storage/object?bucket="+BucketPODocs+"&key="+tc.key, nil))

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tc.wantStatus)
			}
			if got := rec.Header().Get("Content-Type"); got != tc.wantType {
				t.Fatalf("Content-Type = %q, want %q", got, tc.wantType)
			}
			if rec.Code != http.StatusOK {
				return
			}
			if got := rec.Header().Get("Content-Disposition"); got != tc.wantDisposition {
				t.Fatalf("Content-Disposition = %q, want %q", got, tc.wantDisposition)
			}
			if got := rec.Header().Get("Content-Length"); got != strconv.Itoa(len(tc.store.body)) {
				t.Fatalf("Content-Length = %q, want %d", got, len(tc.store.body))
			}
			if got := rec.Header().Get("Cache-Control"); got != "private, max-age=300" {
				t.Fatalf("Cache-Control = %q", got)
			}
			if rec.Body.String() != tc.store.body {
				t.Fatalf("body = %q, want %q", rec.Body.String(), tc.store.body)
			}
			if !tc.store.closed {
				t.Fatal("the object reader was not closed")
			}
		})
	}
}

// Download without storage fails.
func TestHandler_Get_NoStorage(t *testing.T) {
	rec := httptest.NewRecorder()
	NewHandler(nil).Get(rec, httptest.NewRequest(http.MethodGet,
		"/storage/object?bucket="+BucketPODocs+"&key=po/1/a.pdf", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
}
