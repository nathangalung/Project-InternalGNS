package clients

import (
	"context"
	"errors"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/assetproxy"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/rolegate"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/roles"
	"github.com/nathangalung/internalgns/apps/api/internal/storage"
)

const (
	logoUploadExpiry   = 15 * time.Minute
	logoDownloadExpiry = 1 * time.Hour
)

func Routes(d deps.Deps) chi.Router {
	r := chi.NewRouter()
	repo := NewRepo(d.Pool, d.Queries)
	h := NewHandler(repo)

	r.Get("/", h.List)
	// Finance input changes only NPWP and TKU, through PUT /{id}.
	finInput := rolegate.Deny(roles.FinanceInput)
	r.With(finInput).Post("/", h.Create)
	r.Get("/summary", h.Summary)
	r.Get("/search", h.Search)
	r.Get("/{id}", h.Get)
	r.Put("/{id}", h.Update)
	r.Get("/{id}/contacts", h.ListContacts)
	r.Get("/{id}/quotations", h.RecentQuotations)
	r.With(finInput).Post("/{id}/contacts", h.CreateContact)
	r.With(finInput).Patch("/{id}/contacts/{contactId}", h.UpdateContact)
	r.With(finInput).Delete("/{id}/contacts/{contactId}", h.DeleteContact)

	logo := logoAsset(d.Storage, d.Objects, repo)
	r.With(finInput).Get("/{id}/logo/upload-url", assetproxy.Upload(logo))
	r.Get("/{id}/logo/download-url", assetproxy.Download(logo))
	r.With(finInput).Patch("/{id}/logo", assetproxy.UpdateKey(logo))

	return r
}

// logoAsset describes logo routes.
func logoAsset(sc *storage.Client, objects deps.ObjectStore, repo *Repo) assetproxy.Descriptor {
	return assetproxy.Descriptor{
		Storage:     sc,
		Objects:     objects,
		Bucket:      storage.BucketClientLogos,
		KeyPrefix:   "clients",
		NotFoundMsg: "client not found",
		NoAssetMsg:  "no logo attached",
		UploadTTL:   logoUploadExpiry,
		DownloadTTL: logoDownloadExpiry,
		Exists: func(ctx context.Context, id int64) error {
			_, err := repo.GetByID(ctx, id)
			return assetErr(err)
		},
		CurrentAsset: func(ctx context.Context, id int64) (assetproxy.Asset, error) {
			c, err := repo.GetByID(ctx, id)
			if err != nil {
				return assetproxy.Asset{}, assetErr(err)
			}
			var key string
			if c.LogoObjectKey != nil {
				key = *c.LogoObjectKey
			}
			return assetproxy.Asset{Key: key}, nil
		},
		SetKey: func(ctx context.Context, id int64, key string, actor int64) error {
			return assetErr(repo.UpdateLogo(ctx, id, key, actor))
		},
	}
}

// assetErr maps onto shared sentinels.
func assetErr(err error) error {
	if errors.Is(err, ErrNotFound) {
		return assetproxy.ErrNotFound
	}
	return err
}
