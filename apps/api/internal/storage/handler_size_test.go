package storage

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Reads bodies like MinIO.
type drainingStore struct {
	fakeStore
	stored int64
}

func (d *drainingStore) PutObject(_ context.Context, _, _ string, r io.Reader, _ int64, _ string) error {
	n, err := io.Copy(io.Discard, r)
	if err != nil {
		return fmt.Errorf("storage: put object: %w", err)
	}
	d.stored = n
	d.puts++
	return nil
}

// Oversize upload is client error.
// It must answer 413 as problem+json, reach no object, and log nothing at
// ERROR: a 502 here told the user the store was down and paged the 5xx
// alert for a file that was only too large.
func TestHandler_Put_OversizeIsRefused(t *testing.T) {
	limit := MaxBytes(BucketClientLogos)
	url := "/storage/object?bucket=" + BucketClientLogos + "&key=clients/7/1-logo.png"

	cases := []struct {
		name          string
		size          int64
		declareLength bool
		wantStatus    int
		wantPuts      int
	}{
		{"at the cap", limit, true, http.StatusNoContent, 1},
		{"declared past the cap", limit + 1, true, http.StatusRequestEntityTooLarge, 0},
		{"streamed past the cap", limit + 1, false, http.StatusRequestEntityTooLarge, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			logs := &logCapture{}
			prev := slog.Default()
			slog.SetDefault(slog.New(logs))
			t.Cleanup(func() { slog.SetDefault(prev) })

			store := &drainingStore{}
			h := newHandlerWithStore(store)
			body := bytes.Repeat([]byte{'x'}, int(tc.size))
			req := httptest.NewRequest(http.MethodPut, url, bytes.NewReader(body))
			if tc.declareLength {
				req.ContentLength = tc.size
			} else {
				// A chunked upload announces no length.
				req.ContentLength = -1
			}
			rec := httptest.NewRecorder()
			h.Put(rec, req)

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d (body %s)", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if store.puts != tc.wantPuts {
				t.Fatalf("stored objects = %d, want %d", store.puts, tc.wantPuts)
			}
			if tc.wantStatus == http.StatusNoContent {
				if store.stored != tc.size {
					t.Fatalf("stored %d bytes, want %d", store.stored, tc.size)
				}
				return
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
				t.Fatalf("Content-Type = %q, want application/problem+json", ct)
			}
			if len(logs.msgs) != 0 {
				t.Fatalf("an oversize upload logged %v; it is not a server fault", logs.msgs)
			}
		})
	}
}
