package auth

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/httprate"
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

func Routes(h *Handler, requireAuth func(http.Handler) http.Handler) chi.Router {
	r := chi.NewRouter()

	r.With(limitBy(5)).Post("/login", h.Login)
	r.With(limitBy(20)).Post("/refresh", h.Refresh)
	r.Post("/logout", h.Logout)

	r.Group(func(r chi.Router) {
		r.Use(requireAuth)
		r.Get("/me", h.Me)
		r.With(limitBy(5)).Patch("/me/password", h.ChangeOwnPassword)
	})
	return r
}
