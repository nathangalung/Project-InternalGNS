package quotations

import (
	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
)

func Routes(d deps.Deps) chi.Router {
	r := chi.NewRouter()
	h := NewHandler(NewRepo(d.Pool))

	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Get("/stats", h.Stats)
	r.Get("/{id}", h.Get)
	r.Put("/{id}", h.Update)
	r.Patch("/{id}/status", h.ChangeStatus)
	r.Post("/{id}/send", h.Send)

	return r
}
