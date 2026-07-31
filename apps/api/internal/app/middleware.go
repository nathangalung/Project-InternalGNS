package app

import (
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/storage"
)

// Sets client IP from the last proxy hop.
func trustedProxyIP(next http.Handler) http.Handler {
	// Our single reverse proxy appends the real client to X-Forwarded-For,
	// so the last hop is trustworthy. True-Client-IP, X-Real-IP, and earlier
	// XFF entries are attacker-controlled and must not key the rate limiter.
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			if last := strings.TrimSpace(parts[len(parts)-1]); last != "" {
				r.RemoteAddr = last
			}
		}
		next.ServeHTTP(w, r)
	})
}

// Propagate request id header.
func requestIDResponseMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if id := middleware.GetReqID(r.Context()); id != "" {
			w.Header().Set(middleware.RequestIDHeader, id)
		}
		next.ServeHTTP(w, r)
	})
}

// Per-request slog access logger.
func accessLogMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" {
			next.ServeHTTP(w, r)
			return
		}
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		start := time.Now()
		next.ServeHTTP(ww, r)
		elapsed := time.Since(start)
		status := ww.Status()
		attrs := []slog.Attr{
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.Int("status", status),
			slog.Int("bytes", ww.BytesWritten()),
			slog.Duration("duration", elapsed),
			slog.String("remote", r.RemoteAddr),
			slog.String("request_id", middleware.GetReqID(r.Context())),
		}
		level := slog.LevelInfo
		switch {
		case status >= 500:
			level = slog.LevelError
		case status >= 400:
			level = slog.LevelWarn
		}
		slog.LogAttrs(r.Context(), level, "http_request", attrs...)
	})
}

// Set nosniff on every response.
func securityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		// The API serves JSON and proxied asset bytes; nothing it returns
		// should execute script or be framed. Embedding pages (the SPA) are
		// governed by their own CSP, not this one.
		w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		next.ServeHTTP(w, r)
	})
}

// Gates the storage proxy by bucket role.
func authorizeBucket(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		bucket := r.URL.Query().Get("bucket")
		if !storage.CanAccessBucket(deps.CurrentUserRole(r.Context()), bucket) {
			httperr.Render(w, httperr.Forbidden("insufficient role for bucket"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Cap request body size.
func bodyLimitMiddleware(maxBytes int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet, http.MethodHead, http.MethodOptions, http.MethodDelete:
				next.ServeHTTP(w, r)
				return
			}
			// Asset uploads stream large files; they cap their own body.
			if strings.HasPrefix(r.URL.Path, "/api/v1/storage/") {
				next.ServeHTTP(w, r)
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
			next.ServeHTTP(w, r)
		})
	}
}

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
			ctx = deps.WithUserRole(ctx, string(claims.Role))
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// requireRole gates a subtree by role.
func requireRole(roles ...string) func(http.Handler) http.Handler {
	allowed := make(map[string]struct{}, len(roles))
	for _, role := range roles {
		allowed[role] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if _, ok := allowed[deps.CurrentUserRole(r.Context())]; !ok {
				httperr.Render(w, httperr.Forbidden("insufficient role"))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
