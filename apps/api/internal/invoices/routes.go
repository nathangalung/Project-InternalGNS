package invoices

import (
	"context"
	"errors"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/pdfgen"
	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/assetproxy"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/storage"
)

const (
	attachmentUploadExpiry   = 15 * time.Minute
	attachmentDownloadExpiry = 1 * time.Hour
)

func Routes(d deps.Deps) chi.Router {
	r := chi.NewRouter()
	repo := NewRepo(d.Pool, d.Queries)
	h := NewHandler(repo)
	clientsRepo := clients.NewRepo(d.Pool, d.Queries)

	r.Get("/", h.List)
	r.Get("/summary", h.Summary)
	r.Get("/export.xlsx", h.Export)
	r.Get("/by-quotation/{quotationId}", h.GetByQuotation)
	r.Get("/{id}", h.Get)
	r.Get("/{id}/items", h.ListItems)
	r.Patch("/{id}/status", h.ChangeStatus)
	r.Patch("/{id}/dates", h.UpdateDates)

	attachment := attachmentAsset(d.Storage, repo)
	r.Get("/{id}/attachment/upload-url", assetproxy.Upload(attachment))
	r.Get("/{id}/attachment/download-url", assetproxy.Download(attachment))
	r.Patch("/{id}/attachment", assetproxy.UpdateKey(attachment))

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

// attachmentAsset describes the invoice attachment routes.
func attachmentAsset(sc *storage.Client, repo *Repo) assetproxy.Descriptor {
	return assetproxy.Descriptor{
		Storage:     sc,
		Bucket:      storage.BucketInvoiceAttachments,
		KeyPrefix:   "invoices",
		NotFoundMsg: "invoice not found",
		NoAssetMsg:  "no attachment",
		UploadTTL:   attachmentUploadExpiry,
		DownloadTTL: attachmentDownloadExpiry,
		Exists: func(ctx context.Context, id int64) error {
			_, err := repo.GetByID(ctx, id)
			return assetErr(err)
		},
		CurrentAsset: func(ctx context.Context, id int64) (assetproxy.Asset, error) {
			inv, err := repo.GetByID(ctx, id)
			if err != nil {
				return assetproxy.Asset{}, assetErr(err)
			}
			var key string
			if inv.AttachmentObjectKey != nil {
				key = *inv.AttachmentObjectKey
			}
			return assetproxy.Asset{Key: key}, nil
		},
		SetKey: func(ctx context.Context, id int64, key string, actor int64) error {
			return assetErr(repo.UpdateAttachment(ctx, id, key, actor))
		},
	}
}

// assetErr maps the package sentinel onto the shared one.
func assetErr(err error) error {
	if errors.Is(err, ErrNotFound) {
		return assetproxy.ErrNotFound
	}
	return err
}
