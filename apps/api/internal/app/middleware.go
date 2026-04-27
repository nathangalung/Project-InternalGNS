package app

import (
	"net/http"
	"strings"

	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
)

func authMiddleware(svc *auth.Service) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw := r.Header.Get("Authorization")
			token, ok := strings.CutPrefix(raw, "Bearer ")
			if !ok || token == "" {
				httperr.Render(w, httperr.Unauthorized("missing bearer token"))
				return
			}

			claims, err := svc.Verify(token)
			if err != nil {
				httperr.Render(w, httperr.Unauthorized("invalid or expired token"))
				return
			}

			userID, err := claims.UserID()
			if err != nil {
				httperr.Render(w, httperr.Unauthorized("malformed token subject"))
				return
			}

			ctx := deps.WithUserID(r.Context(), userID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
