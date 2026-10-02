package storage

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// An unknown length is refused.
// minio-go buffers a whole ~512 MiB part for a body of unknown size, so a
// few chunked uploads could exhaust the API's memory. The browser always
// sends a File, which carries Content-Length.
func TestHandler_Put_RequiresLength(t *testing.T) {
	store := &fakeStore{}
	h := newHandlerWithStore(store)
	req := httptest.NewRequest(http.MethodPut,
		"/storage/object?bucket="+BucketClientLogos+"&key=clients/7/1-logo.png", strings.NewReader("png"))
	req.ContentLength = -1
	rec := httptest.NewRecorder()
	h.Put(rec, req)

	if rec.Code != http.StatusLengthRequired {
		t.Fatalf("status = %d, want 411 (body %s)", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Fatalf("Content-Type = %q, want application/problem+json", ct)
	}
	var p struct {
		Detail string `json:"detail"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&p); err != nil {
		t.Fatal(err)
	}
	if p.Detail != "Ukuran berkas tidak diketahui. Unggah ulang berkasnya." {
		t.Fatalf("detail = %q", p.Detail)
	}
	if store.puts != 0 {
		t.Fatalf("stored objects = %d, want 0", store.puts)
	}
}
