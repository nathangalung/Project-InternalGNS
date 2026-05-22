package auth

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/httprate"
)

func Routes(h *Handler, requireAuth func(http.Handler) http.Handler) chi.Router {
	r := chi.NewRouter()

	r.With(httprate.LimitByIP(5, time.Minute)).Post("/login", h.Login)
	r.With(httprate.LimitByIP(20, time.Minute)).Post("/refresh", h.Refresh)
	r.Post("/logout", h.Logout)

	r.Group(func(r chi.Router) {
		r.Use(requireAuth)
		r.Get("/me", h.Me)
	})
	return r
}
