package quotations

import (
	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/pdfgen"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/units"
)

func Routes(d deps.Deps) chi.Router {
	r := chi.NewRouter()
	repo := NewRepo(d.Pool, d.Queries)
	h := NewHandler(repo)

	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Get("/stats", h.Stats)
	r.Get("/{id}", h.Get)
	r.Put("/{id}", h.Update)
	r.Patch("/{id}/status", h.ChangeStatus)
	r.Post("/{id}/send", h.Send)

	if d.TemplatesRoot != "" {
		exp := NewExportHandler(
			repo,
			clients.NewRepo(d.Pool, d.Queries),
			units.NewRepo(d.Pool, d.Queries),
			pdfgen.NewRenderer(d.TemplatesRoot),
			d.Pdf,
		)
		r.Get("/{id}/pdf", exp.ExportPDF)
	}

	return r
}
