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

	// One folder per invoice.
	// Proofs keep a sub-folder, so an attachment never passes as a proof or the
	// other way round.
	keyPrefix   = "invoices"
	proofKeySub = "payment"
)

// ProofStore confirms uploaded proofs exist.
type ProofStore interface {
	ObjectExists(ctx context.Context, bucket, key string) (bool, error)
}

// proofFolder locates invoice proofs.
func proofFolder(id int64) string {
	return storage.OwnerFolder(keyPrefix, id, proofKeySub)
}

// Routes mounts the invoice API.
func Routes(d deps.Deps) chi.Router {
	// A nil client must stay a nil interface.
	var proofs ProofStore
	if d.Storage != nil {
		proofs = d.Storage
	}
	return RoutesWithProofs(d, proofs)
}

// RoutesWithProofs injects the proof store.
// Tests pass a fake; production goes through Routes.
func RoutesWithProofs(d deps.Deps, proofs ProofStore) chi.Router {
	r := chi.NewRouter()
	repo := NewRepo(d.Pool, d.Queries)
	h := NewHandler(repo, proofs)
	clientsRepo := clients.NewRepo(d.Pool, d.Queries)

	r.Get("/", h.List)
	r.Get("/summary", h.Summary)
	r.Get("/export.xlsx", h.Export)
	r.Get("/by-quotation/{quotationId}", h.GetByQuotation)
	r.Get("/{id}", h.Get)
	r.Get("/{id}/items", h.ListItems)
	r.Patch("/{id}/status", h.ChangeStatus)
	r.Post("/{id}/replacement", h.Replace)
	r.Patch("/{id}/dates", h.UpdateDates)

	attachment := attachmentAsset(d.Storage, repo)
	r.Get("/{id}/attachment/upload-url", assetproxy.Upload(attachment))
	r.Get("/{id}/attachment/download-url", assetproxy.Download(attachment))
	r.Patch("/{id}/attachment", assetproxy.UpdateKey(attachment))

	// Paid status saves the key.
	proof := paymentProofAsset(d.Storage, repo)
	r.Get("/{id}/payment-proof/upload-url", assetproxy.Upload(proof))
	r.Get("/{id}/payment-proof/download-url", assetproxy.Download(proof))

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

// attachmentAsset describes attachment routes.
func attachmentAsset(sc *storage.Client, repo *Repo) assetproxy.Descriptor {
	return assetproxy.Descriptor{
		Storage:     sc,
		Bucket:      storage.BucketInvoiceAttachments,
		KeyPrefix:   keyPrefix,
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

// paymentProofAsset describes proof routes.
func paymentProofAsset(sc *storage.Client, repo *Repo) assetproxy.Descriptor {
	d := attachmentAsset(sc, repo)
	d.KeySub = proofKeySub
	d.NoAssetMsg = "no payment proof"
	d.CurrentAsset = func(ctx context.Context, id int64) (assetproxy.Asset, error) {
		inv, err := repo.GetByID(ctx, id)
		if err != nil {
			return assetproxy.Asset{}, assetErr(err)
		}
		var key string
		if inv.PaymentProofKey != nil {
			key = *inv.PaymentProofKey
		}
		return assetproxy.Asset{Key: key}, nil
	}
	d.SetKey = nil
	return d
}

// assetErr maps onto shared sentinels.
func assetErr(err error) error {
	if errors.Is(err, ErrNotFound) {
		return assetproxy.ErrNotFound
	}
	return err
}
