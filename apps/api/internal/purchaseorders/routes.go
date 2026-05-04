package purchaseorders

import (
	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
)

func Routes(d deps.Deps) chi.Router {
	r := chi.NewRouter()
	h := NewHandler(NewRepo(d.Pool, d.Queries))

	r.Get("/", h.List)
	r.Get("/by-quotation/{quotationId}", h.GetByQuotation)
	r.Get("/{id}", h.Get)
	r.Patch("/{id}/status", h.ChangeStatus)
	r.Patch("/{id}/file", h.UpdateFile)
	r.Patch("/{id}/notes", h.UpdateNotes)

	return r
}
