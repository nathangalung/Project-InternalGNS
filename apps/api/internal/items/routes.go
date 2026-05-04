package items

import (
	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
)

func Routes(d deps.Deps) chi.Router {
	r := chi.NewRouter()
	h := NewHandler(NewRepo(d.Pool, d.Queries))

	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Get("/search", h.Search)
	r.Post("/match-request", h.MatchRequest)
	r.Get("/{id}", h.Get)
	r.Put("/{id}", h.Update)
	r.Get("/{id}/vendors", h.ListVendorsForItem)
	r.Post("/{id}/vendors", h.AddVendor)
	r.Get("/{id}/price-history", h.PriceHistory)

	return r
}
