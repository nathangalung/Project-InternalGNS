package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
)

func TestRequireRole(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	guarded := requireRole("superadmin")(next)

	cases := []struct {
		role string
		want int
	}{
		{"superadmin", http.StatusOK},
		{"finance", http.StatusForbidden},
		{"operational", http.StatusForbidden},
		{"", http.StatusForbidden},
	}
	for _, c := range cases {
		req := httptest.NewRequest(http.MethodGet, "/users", nil)
		req = req.WithContext(deps.WithUserRole(req.Context(), c.role))
		rec := httptest.NewRecorder()
		guarded.ServeHTTP(rec, req)
		if rec.Code != c.want {
			t.Errorf("role %q: got %d want %d", c.role, rec.Code, c.want)
		}
	}
}

func TestReadOnlyFor(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	guarded := readOnlyFor("finance")(next)

	cases := []struct {
		role   string
		method string
		path   string
		want   int
	}{
		{"finance", http.MethodGet, "/items/1", http.StatusOK},
		{"finance", http.MethodHead, "/items/1", http.StatusOK},
		{"finance", http.MethodOptions, "/items/", http.StatusOK},
		{"finance", http.MethodGet, "/items/1/image/download-url", http.StatusOK},
		{"finance", http.MethodGet, "/items/1/image/upload-url", http.StatusForbidden},
		{"finance", http.MethodPost, "/items/", http.StatusForbidden},
		{"finance", http.MethodPut, "/items/1", http.StatusForbidden},
		{"finance", http.MethodPatch, "/items/1/image", http.StatusForbidden},
		{"finance", http.MethodDelete, "/items/1", http.StatusForbidden},
		{"operational", http.MethodPost, "/items/", http.StatusOK},
		{"operational", http.MethodGet, "/items/1/image/upload-url", http.StatusOK},
		{"superadmin", http.MethodPut, "/items/1", http.StatusOK},
	}
	for _, c := range cases {
		req := httptest.NewRequest(c.method, c.path, nil)
		req = req.WithContext(deps.WithUserRole(req.Context(), c.role))
		rec := httptest.NewRecorder()
		guarded.ServeHTTP(rec, req)
		if rec.Code != c.want {
			t.Errorf("%s %s %s: got %d want %d", c.role, c.method, c.path, rec.Code, c.want)
		}
	}
}

// Every role refusal reads in Indonesian.
// The SPA toasts the problem detail as is, and a menu can outlive a role
// change by the length of the cached profile, so a refusal does reach a
// user and must not read "insufficient role".
func TestRoleRefusals_IndonesianDetail(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	cases := []struct {
		name    string
		handler http.Handler
		method  string
		path    string
		detail  string
	}{
		{"mount gate", requireRole("superadmin")(next), http.MethodGet, "/users", detailRoleRefused},
		{"read-only gate", readOnlyFor("finance")(next), http.MethodPost, "/items/", detailRoleRefused},
		{"bucket gate", authorizeBucket(next), http.MethodGet, "/storage/object?bucket=po-docs", detailBucketRefused},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := httptest.NewRequest(c.method, c.path, nil)
			req = req.WithContext(deps.WithUserRole(req.Context(), "finance"))
			rec := httptest.NewRecorder()
			c.handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want 403", rec.Code)
			}
			var p struct {
				Detail string `json:"detail"`
			}
			if err := json.NewDecoder(rec.Body).Decode(&p); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if p.Detail != c.detail {
				t.Fatalf("detail = %q, want %q", p.Detail, c.detail)
			}
		})
	}
	if detailRoleRefused != "Peran Anda tidak memiliki akses ke fitur ini." {
		t.Fatalf("detailRoleRefused = %q", detailRoleRefused)
	}
	if detailBucketRefused != "Peran Anda tidak memiliki akses ke berkas ini." {
		t.Fatalf("detailBucketRefused = %q", detailBucketRefused)
	}
}
