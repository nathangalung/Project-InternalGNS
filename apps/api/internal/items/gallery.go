package items

import (
	"context"
	"errors"
	"net/http"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httpx"
	"github.com/nathangalung/internalgns/apps/api/internal/storage"
)

// galleryHandler serves product photos.
// Adding a photo goes through assetproxy.UpdateKey, which checks the key
// belongs to the item and the upload arrived.
type galleryHandler struct {
	repo    *Repo
	storage *storage.Client
}

// List returns the gallery.
// Each photo carries its download path, fetched by the web as a blob.
func (g galleryHandler) List(w http.ResponseWriter, r *http.Request) {
	if g.storage == nil {
		httperr.Render(w, httperr.ServiceUnavailable("storage not configured"))
		return
	}
	id, ok := httpx.PathID(w, r, "id", "invalid id")
	if !ok {
		return
	}
	if _, err := g.repo.GetByID(r.Context(), id); err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Render(w, httperr.NotFound("item not found"))
			return
		}
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	images, err := g.repo.Images(r.Context(), id)
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	for i := range images {
		images[i].DownloadURL = g.storage.PresignGet(r.Context(), storage.BucketItemImages,
			images[i].ObjectKey, imageDownloadExpiry)
	}
	httpx.WriteJSON(w, http.StatusOK, ItemGallery{Max: MaxItemImages, Images: append([]ItemImage{}, images...)})
}

// Delete removes one photo.
// The object stays in storage for cmd/orphan-blobs.
func (g galleryHandler) Delete(w http.ResponseWriter, r *http.Request) {
	g.change(w, r, g.repo.DeleteImage)
}

// Cover makes a photo the cover.
func (g galleryHandler) Cover(w http.ResponseWriter, r *http.Request) {
	g.change(w, r, g.repo.SetCover)
}

// change runs one photo change.
func (g galleryHandler) change(w http.ResponseWriter, r *http.Request,
	apply func(ctx context.Context, id, imageID, userID int64) error) {
	id, ok := httpx.PathID(w, r, "id", "invalid id")
	if !ok {
		return
	}
	imageID, ok := httpx.PathID(w, r, "imageId", "invalid image id")
	if !ok {
		return
	}
	if err := apply(r.Context(), id, imageID, deps.CurrentUserID(r.Context())); err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
