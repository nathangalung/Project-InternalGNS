package invoices

import (
	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/pdfgen"
	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
)

func Routes(d deps.Deps) chi.Router {
	r := chi.NewRouter()
	repo := NewRepo(d.Pool, d.Queries)
	h := NewHandler(repo)
	h.storage = d.Storage
	clientsRepo := clients.NewRepo(d.Pool, d.Queries)

	r.Get("/", h.List)
	r.Get("/summary", h.Summary)
	r.Get("/export.xlsx", h.Export)
	r.Get("/by-quotation/{quotationId}", h.GetByQuotation)
	r.Get("/{id}", h.Get)
	r.Get("/{id}/items", h.ListItems)
	r.Patch("/{id}/status", h.ChangeStatus)
	r.Patch("/{id}/dates", h.UpdateDates)
	r.Get("/{id}/attachment/upload-url", h.PresignAttachmentUpload)
	r.Get("/{id}/attachment/download-url", h.PresignAttachmentDownload)
	r.Patch("/{id}/attachment", h.UpdateAttachment)

	coretax := NewCoretaxHandler(repo, clientsRepo, d.Coretax, d.TemplatesRoot)
	r.Get("/coretax.xlsx", coretax.ExportBulkXLSX)
	r.Get("/{id}/coretax.xml", coretax.Export)

	if d.TemplatesRoot != "" {
		exp := NewExportHandler(
			repo,
			clientsRepo,
			quotations.NewRepo(d.Pool, d.Queries),
			purchaseorders.NewRepo(d.Pool, d.Queries),
			pdfgen.NewRenderer(d.TemplatesRoot),
			d.Pdf,
		)
		r.Get("/{id}/pdf", exp.ExportPDF)
	}

	return r
}
