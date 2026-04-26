package countries

import (
	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
)

func Routes(d deps.Deps) chi.Router {
	r := chi.NewRouter()
	h := NewHandler(NewRepo(d.Pool))

	r.Get("/", h.List)

	return r
}
