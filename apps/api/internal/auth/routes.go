package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"mime"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/httprate"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/session"
)

// clientIPKey keys limits by client.
// The app router resolves the client with its clientIP middleware; IPv6
// clients share one bucket per /64. Without that middleware the key is empty
// and every request shares a single bucket, which only tightens the limit.
func clientIPKey(r *http.Request) (string, error) {
	return httprate.CanonicalizeIP(middleware.GetClientIP(r.Context())), nil
}

// limitBy limits per client IP.
// Each limiter counts on its own monotonic counter, so a wall-clock step
// cannot reset it.
func limitBy(requestLimit int) func(http.Handler) http.Handler {
	return httprate.LimitBy(requestLimit, time.Minute, clientIPKey,
		httprate.WithLimitCounter(newMonotonicCounter(time.Now)))
}

// Refresh limits per minute.
// Every page load and new tab rotates the cookie, and an office reaches the
// API from one public address, so the address only carries a flood ceiling.
// A 256-bit token needs no brute-force throttle; the per-cookie limit only
// stops one cookie being hammered.
const (
	refreshPerIP     = 300
	refreshPerCookie = 20
)

// refreshCookieKey keys by cookie hash.
// The limiter's map holds a digest, never a live token.
func refreshCookieKey(r *http.Request) (string, error) {
	sum := sha256.Sum256([]byte(session.Read(r)))
	return hex.EncodeToString(sum[:]), nil
}

// refreshLimit limits refresh calls.
// A request without a cookie is answered 401 before any database work, so
// it spends only the address ceiling: a signed-out office must reach the
// login page at once, not after a 429.
func refreshLimit(perIP, perCookie int) func(http.Handler) http.Handler {
	byIP := limitBy(perIP)
	byCookie := httprate.LimitBy(perCookie, time.Minute, refreshCookieKey,
		httprate.WithLimitCounter(newMonotonicCounter(time.Now)))
	return func(next http.Handler) http.Handler {
		limited := byCookie(next)
		return byIP(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if session.Read(r) == "" {
				next.ServeHTTP(w, r)
				return
			}
			limited.ServeHTTP(w, r)
		}))
	}
}

// loginGuard stops login CSRF.
// Login sets the refresh cookie, so a cross-site form or a sibling subdomain
// posting to it would sign the reader into another account. A browser always
// sends Origin on a POST, so any Origin must be listed; a client without one
// (curl, a test harness) is no browser and plants nothing. Only JSON is read,
// a type a plain form cannot send.
func loginGuard(o session.Origins) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if origin := r.Header.Get("Origin"); origin != "" && !o.Allowed(origin) {
				httperr.Render(w, httperr.Forbidden(session.DetailOriginRefused))
				return
			}
			if mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mt != "application/json" {
				httperr.Render(w, httperr.Error{
					Type: "about:blank", Title: "Unsupported Media Type",
					Status: http.StatusUnsupportedMediaType, Detail: DetailJSONOnly,
				})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func Routes(h *Handler, requireAuth func(http.Handler) http.Handler) chi.Router {
	r := chi.NewRouter()

	// Every guard refuses before the limiter counts, so a foreign page cannot
	// spend a reader's login budget. The cookie routes also refuse a missing
	// Origin or CSRF header.
	r.With(loginGuard(h.origins), limitBy(5)).Post("/login", h.Login)
	guard := session.Guard(h.origins)
	r.With(guard, refreshLimit(refreshPerIP, refreshPerCookie)).Post("/refresh", h.Refresh)
	r.With(guard).Post("/logout", h.Logout)

	r.Group(func(r chi.Router) {
		r.Use(requireAuth)
		r.Get("/me", h.Me)
		r.With(limitBy(5)).Patch("/me/password", h.ChangeOwnPassword)
	})
	return r
}
