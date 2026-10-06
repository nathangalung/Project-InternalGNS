package cashentries

import (
	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/rolegate"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/roles"
)

// Routes mounts Kas Lain.
// Finance input lists, adds and edits entries; deleting one and exporting
// the ledger are for the finance head and superadmin.
func Routes(d deps.Deps) chi.Router {
	r := chi.NewRouter()
	h := NewHandler(NewRepo(d.Pool, d.Queries))
	headOnly := rolegate.Deny(roles.FinanceInput)

	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Get("/summary", h.Summary)
	r.Get("/categories", h.Categories)
	r.With(headOnly).Get("/export.xlsx", h.Export)
	r.Get("/{id}", h.Get)
	r.Put("/{id}", h.Update)
	r.With(headOnly).Delete("/{id}", h.Delete)
	return r
}
