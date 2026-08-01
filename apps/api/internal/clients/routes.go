package clients

import (
	"context"
	"errors"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/assetproxy"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
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
	r.Post("/", h.Create)
	r.Get("/summary", h.Summary)
	r.Get("/search", h.Search)
	r.Get("/{id}", h.Get)
	r.Put("/{id}", h.Update)
	r.Get("/{id}/contacts", h.ListContacts)
	r.Post("/{id}/contacts", h.CreateContact)
	r.Patch("/{id}/contacts/{contactId}", h.UpdateContact)
	r.Delete("/{id}/contacts/{contactId}", h.DeleteContact)

	logo := logoAsset(d.Storage, repo)
	r.Get("/{id}/logo/upload-url", assetproxy.Upload(logo))
	r.Get("/{id}/logo/download-url", assetproxy.Download(logo))
	r.Patch("/{id}/logo", assetproxy.UpdateKey(logo))

	return r
}

// logoAsset describes the client logo routes.
func logoAsset(sc *storage.Client, repo *Repo) assetproxy.Descriptor {
	return assetproxy.Descriptor{
		Storage:     sc,
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

// assetErr maps the package sentinel onto the shared one.
func assetErr(err error) error {
	if errors.Is(err, ErrNotFound) {
		return assetproxy.ErrNotFound
	}
	return err
}
