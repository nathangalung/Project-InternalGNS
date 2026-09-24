package storage

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Records what the proxy asked of the object store.
type fakeStore struct {
	exists    bool
	existsErr error
	putErr    error
	puts      int
}

func (f *fakeStore) PutObject(context.Context, string, string, io.Reader, int64, string) error {
	f.puts++
	return f.putErr
}

func (f *fakeStore) GetObject(context.Context, string, string) (io.ReadCloser, string, int64, error) {
	return io.NopCloser(strings.NewReader("")), "", 0, nil
}

func (f *fakeStore) ObjectExists(context.Context, string, string) (bool, error) {
	return f.exists, f.existsErr
}

// A presigned PUT carries a client-supplied key, so without this check any
// role with bucket access could overwrite another record's stored file.
func TestHandler_Put_RefusesOverwrite(t *testing.T) {
	cases := []struct {
		name       string
		store      *fakeStore
		wantStatus int
		wantPuts   int
	}{
		{"new key stored", &fakeStore{exists: false}, http.StatusNoContent, 1},
		{"existing key refused", &fakeStore{exists: true}, http.StatusConflict, 0},
		{"stat failure refuses", &fakeStore{existsErr: errors.New("boom")}, http.StatusBadGateway, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := newHandlerWithStore(tc.store)
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPut,
				"/storage/object?bucket="+BucketItemImages+"&key=items/7/1-a.png",
				strings.NewReader("bytes"))
			h.Put(rec, req)

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d (body %q)", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if tc.store.puts != tc.wantPuts {
				t.Fatalf("PutObject calls = %d, want %d", tc.store.puts, tc.wantPuts)
			}
		})
	}
}

// An attach endpoint takes the key from the client, so it has to prove the
// key belongs to the record it is being attached to.
func TestValidateOwnedKey(t *testing.T) {
	cases := []struct {
		name    string
		bucket  string
		prefix  string
		id      int64
		key     string
		wantErr bool
	}{
		{"own key", BucketItemImages, "items", 7, "items/7/1790-a.png", false},
		{"another record", BucketItemImages, "items", 7, "items/8/1790-a.png", true},
		{"prefix overlap", BucketItemImages, "items", 7, "items/70/1790-a.png", true},
		{"other namespace", BucketItemImages, "items", 7, "clients/7/1790-a.png", true},
		{"traversal", BucketClientLogos, "clients", 42, "../../etc/x", true},
		{"absolute", BucketClientLogos, "clients", 42, "/clients/42/a.png", true},
		{"bare prefix", BucketItemImages, "items", 7, "items/7/", true},
		{"disallowed extension", BucketItemImages, "items", 7, "items/7/1790-a.exe", true},
		{"empty", BucketItemImages, "items", 7, "", true},
		{"another asset's sub-folder", BucketInvoiceAttachments, "invoices", 7, "invoices/7/payment/1790-a.pdf", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateOwnedKey(tc.bucket, tc.prefix, tc.id, tc.key)
			if tc.wantErr && err == nil {
				t.Fatalf("ValidateOwnedKey(%q) = nil, want error", tc.key)
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("ValidateOwnedKey(%q) = %v, want nil", tc.key, err)
			}
		})
	}
}

// A sub-folder asset is bound to its own folder.
func TestValidateFolderKey(t *testing.T) {
	folder := OwnerFolder("invoices", 7, "payment")
	cases := []struct {
		name    string
		key     string
		wantErr bool
	}{
		{"own folder", "invoices/7/payment/1790-a.pdf", false},
		{"the record's root folder", "invoices/7/1790-a.pdf", true},
		{"another record's folder", "invoices/8/payment/1790-a.pdf", true},
		{"prefix overlap", "invoices/70/payment/1790-a.pdf", true},
		{"deeper folder", "invoices/7/payment/x/1790-a.pdf", true},
		{"traversal out", "invoices/7/payment/../1790-a.pdf", true},
		{"bare folder", "invoices/7/payment/", true},
		{"disallowed extension", "invoices/7/payment/1790-a.exe", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateFolderKey(BucketInvoiceAttachments, folder, tc.key)
			if tc.wantErr != (err != nil) {
				t.Fatalf("ValidateFolderKey(%q) = %v, wantErr %v", tc.key, err, tc.wantErr)
			}
		})
	}
}
