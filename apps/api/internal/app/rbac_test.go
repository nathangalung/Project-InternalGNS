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
