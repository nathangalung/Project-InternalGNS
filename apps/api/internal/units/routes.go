package units

import (
	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
)

// Units chi router.
func Routes(d deps.Deps) chi.Router {
	r := chi.NewRouter()
	h := NewHandler(NewRepo(d.Pool, d.Queries))

	r.Get("/", h.List)

	return r
}
