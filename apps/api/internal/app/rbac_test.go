package app

import (
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
