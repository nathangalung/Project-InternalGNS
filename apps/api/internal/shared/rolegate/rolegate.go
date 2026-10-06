package rolegate

import (
	"net/http"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
)

// RefusedDetail is the role refusal.
// The SPA toasts it as is, so it reads Indonesian.
const RefusedDetail = "Peran Anda tidak memiliki akses ke fitur ini."

// Refused renders the role refusal.
func Refused(w http.ResponseWriter) {
	httperr.Render(w, httperr.Forbidden(RefusedDetail))
}

// Deny refuses roles a route.
// Use the roles constants; an unknown role passes, so pair it with a mount
// gate that admits only known roles.
func Deny(denied ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			role := deps.CurrentUserRole(r.Context())
			for _, d := range denied {
				if role == d {
					Refused(w)
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}
