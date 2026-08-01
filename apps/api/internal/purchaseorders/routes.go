package purchaseorders

import (
	"context"
	"errors"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/pdfgen"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/assetproxy"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/storage"
)

const (
	uploadURLExpiry   = 15 * time.Minute
	downloadURLExpiry = 1 * time.Hour
)

func Routes(d deps.Deps) chi.Router {
	r := chi.NewRouter()
	repo := NewRepo(d.Pool, d.Queries)
	h := NewHandler(repo)

	doc := docAsset(d.Storage, repo)
	r.Get("/", h.List)
	r.Get("/export.xlsx", h.Export)
	r.Get("/by-quotation/{quotationId}", h.GetByQuotation)
	r.Get("/{id}", h.Get)
	r.Get("/{id}/items", h.ListItems)
	r.Get("/{id}/upload-url", assetproxy.Upload(doc))
	r.Get("/{id}/download-url", assetproxy.Download(doc))
	r.Patch("/{id}/status", h.ChangeStatus)
	r.Patch("/{id}/file", h.UpdateFile)
	r.Patch("/{id}/notes", h.UpdateNotes)
	r.Patch("/{id}/details", h.UpdateDetails)
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

// docAsset describes the PO document routes. SetKey stays nil: PATCH
// /{id}/file also persists the original name and size, so it keeps its
// own handler rather than assetproxy.UpdateKey.
func docAsset(sc *storage.Client, repo *Repo) assetproxy.Descriptor {
	return assetproxy.Descriptor{
		Storage:     sc,
		Bucket:      storage.BucketPODocs,
		KeyPrefix:   "po",
		NotFoundMsg: "purchase order not found",
		NoAssetMsg:  "no file attached",
		UploadTTL:   uploadURLExpiry,
		DownloadTTL: downloadURLExpiry,
		Exists: func(ctx context.Context, id int64) error {
			_, err := repo.GetByID(ctx, id)
			return assetErr(err)
		},
		CurrentAsset: func(ctx context.Context, id int64) (assetproxy.Asset, error) {
			po, err := repo.GetByID(ctx, id)
			if err != nil {
				return assetproxy.Asset{}, assetErr(err)
			}
			var key string
			if po.FileURL != nil {
				key = *po.FileURL
			}
			return assetproxy.Asset{
				Key:   key,
				Extra: map[string]any{"fileName": po.FileName},
			}, nil
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
