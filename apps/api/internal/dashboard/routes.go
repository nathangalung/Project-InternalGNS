package dashboard

import (
	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
)

// Dashboard chi router.
func Routes(d deps.Deps) chi.Router {
	r := chi.NewRouter()
	h := NewHandler(NewRepo(d.Pool, d.Queries))

	r.Get("/summary", h.Summary)
	r.Get("/timeseries", h.Timeseries)
	r.Get("/export.xlsx", h.Export)

	return r
}
