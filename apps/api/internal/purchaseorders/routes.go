package purchaseorders

import (
	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/pdfgen"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
)

func Routes(d deps.Deps) chi.Router {
	r := chi.NewRouter()
	repo := NewRepo(d.Pool, d.Queries)
	h := NewHandler(repo)
	h.storage = d.Storage

	r.Get("/", h.List)
	r.Get("/by-quotation/{quotationId}", h.GetByQuotation)
	r.Get("/{id}", h.Get)
	r.Get("/{id}/items", h.ListItems)
	r.Get("/{id}/upload-url", h.PresignUpload)
	r.Get("/{id}/download-url", h.PresignDownload)
	r.Patch("/{id}/status", h.ChangeStatus)
	r.Patch("/{id}/file", h.UpdateFile)
	r.Patch("/{id}/notes", h.UpdateNotes)
	r.Put("/{id}/items", h.UpdateItems)

	if d.TemplatesRoot != "" {
		dn := NewDeliveryNoteHandler(
			repo,
			clients.NewRepo(d.Pool, d.Queries),
			quotations.NewRepo(d.Pool, d.Queries),
			pdfgen.NewRenderer(d.TemplatesRoot),
			d.Pdf,
		)
		r.Get("/{id}/delivery-note.pdf", dn.ExportPDF)
	}

	return r
}
