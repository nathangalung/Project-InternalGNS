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

func Routes(h *Handler, requireAuth func(http.Handler) http.Handler) chi.Router {
	r := chi.NewRouter()

	r.With(httprate.LimitBy(5, time.Minute, clientIPKey)).Post("/login", h.Login)
	r.With(httprate.LimitBy(20, time.Minute, clientIPKey)).Post("/refresh", h.Refresh)
	r.Post("/logout", h.Logout)

	r.Group(func(r chi.Router) {
		r.Use(requireAuth)
		r.Get("/me", h.Me)
		r.With(httprate.LimitBy(5, time.Minute, clientIPKey)).Patch("/me/password", h.ChangeOwnPassword)
	})
	return r
}
