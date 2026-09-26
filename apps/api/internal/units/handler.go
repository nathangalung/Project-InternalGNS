package units

import (
	"net/http"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httpx"
)

// HTTP handler.
type Handler struct {
	repo *Repo
}

func NewHandler(repo *Repo) *Handler {
	return &Handler{repo: repo}
}

// List handles GET /units.
// Master data, no pagination needed.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	units, err := h.repo.ListAll(r.Context())
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	httpx.WriteList(w, int64(len(units)), units)
}
