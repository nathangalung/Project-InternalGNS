package items

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
	imageUploadExpiry   = 15 * time.Minute
	imageDownloadExpiry = 1 * time.Hour
)

func Routes(d deps.Deps) chi.Router {
	r := chi.NewRouter()
	repo := NewRepo(d.Pool, d.Queries)
	h := NewHandler(repo)

	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Get("/search-advanced", h.SearchAdvanced)
	r.Post("/match-rows", h.MatchRows)
	r.Get("/recommendations", h.Recommendations)
	r.Get("/{id}", h.Get)
	r.Put("/{id}", h.Update)
	r.Get("/{id}/vendors", h.ListVendorsForItem)
	r.Post("/{id}/vendors", h.AddVendor)
	r.Get("/{id}/price-history", h.PriceHistory)

	image := imageAsset(d.Storage, d.Objects, repo)
	r.Get("/{id}/image/upload-url", assetproxy.Upload(image))
	r.Get("/{id}/image/download-url", assetproxy.Download(image))
	gallery := galleryHandler{repo: repo, storage: d.Storage}
	r.Get("/{id}/images", gallery.List)
	r.Post("/{id}/images", assetproxy.UpdateKey(image))
	r.Delete("/{id}/images/{imageId}", gallery.Delete)
	r.Put("/{id}/images/{imageId}/cover", gallery.Cover)

	return r
}

// imageAsset describes image routes.
func imageAsset(sc *storage.Client, objects deps.ObjectStore, repo *Repo) assetproxy.Descriptor {
	return assetproxy.Descriptor{
		Storage:     sc,
		Objects:     objects,
		Bucket:      storage.BucketItemImages,
		KeyPrefix:   "items",
		NotFoundMsg: "item not found",
		NoAssetMsg:  "no image attached",
		UploadTTL:   imageUploadExpiry,
		DownloadTTL: imageDownloadExpiry,
		Exists: func(ctx context.Context, id int64) error {
			_, err := repo.GetByID(ctx, id)
			return assetErr(err)
		},
		CurrentAsset: func(ctx context.Context, id int64) (assetproxy.Asset, error) {
			item, err := repo.GetByID(ctx, id)
			if err != nil {
				return assetproxy.Asset{}, assetErr(err)
			}
			var key string
			if item.ImageObjectKey != nil {
				key = *item.ImageObjectKey
			}
			return assetproxy.Asset{Key: key}, nil
		},
		// An attached key joins the gallery; CurrentAsset is the cover.
		SetKey: func(ctx context.Context, id int64, key string, actor int64) error {
			_, err := repo.AddImage(ctx, id, key, actor)
			return assetErr(err)
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
