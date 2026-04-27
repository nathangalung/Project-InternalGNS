package units

import (
	"encoding/json"
	"net/http"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
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
		httperr.Render(w, httperr.Internal(err.Error()))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(units)
}
