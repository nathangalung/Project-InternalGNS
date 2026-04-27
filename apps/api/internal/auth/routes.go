package auth

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// Mount auth routes.
func Routes(h *Handler, requireAuth func(http.Handler) http.Handler) chi.Router {
	r := chi.NewRouter()
	r.Post("/login", h.Login)
	r.Post("/logout", h.Logout)

	r.Group(func(r chi.Router) {
		r.Use(requireAuth)
		r.Get("/me", h.Me)
	})
	return r
}
