package vendors

import (
	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
)

func Routes(d deps.Deps) chi.Router {
	r := chi.NewRouter()
	h := NewHandler(NewRepo(d.Pool, d.Queries))
	h.storage = d.Storage

	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Get("/search", h.Search)
	r.Get("/{id}", h.Get)
	r.Put("/{id}", h.Update)
	r.Get("/{id}/items", h.ListItems)
	r.Get("/{id}/logo/upload-url", h.PresignLogoUpload)
	r.Get("/{id}/logo/download-url", h.PresignLogoDownload)
	r.Patch("/{id}/logo", h.UpdateLogo)

	return r
}
