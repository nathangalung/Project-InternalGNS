package items

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
	r.Get("/search-advanced", h.SearchAdvanced)
	r.Post("/match-request", h.MatchRequest)
	r.Post("/match-rows", h.MatchRows)
	r.Get("/{id}", h.Get)
	r.Put("/{id}", h.Update)
	r.Get("/{id}/vendors", h.ListVendorsForItem)
	r.Post("/{id}/vendors", h.AddVendor)
	r.Get("/{id}/price-history", h.PriceHistory)
	r.Get("/{id}/image/upload-url", h.PresignImageUpload)
	r.Get("/{id}/image/download-url", h.PresignImageDownload)
	r.Patch("/{id}/image", h.UpdateImage)

	return r
}
