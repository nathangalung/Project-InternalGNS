package invoices

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httpx"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/validate"
)

// maxDescription caps one line's text.
// It matches invoice_items.description.
const maxDescription = 500

// UpdateDescriptions saves line descriptions.
// If-Match is required. A paid or cancelled invoice is a 409, a line of
// another invoice a 422.
func (h *Handler) UpdateDescriptions(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	var req UpdateDescriptionsRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	ifMatch, err := httpx.ParseIfMatch(r.Header.Get("If-Match"))
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid If-Match header"))
		return
	}
	if ifMatch == nil {
		httperr.Render(w, httperr.BadRequest("If-Match header required"))
		return
	}
	if fields := validateDescriptions(req.Lines); len(fields) > 0 {
		httperr.Render(w, httperr.Unprocessable(fields))
		return
	}
	v, err := h.repo.UpdateDescriptions(r.Context(), id, req.Lines, deps.CurrentUserID(r.Context()), ifMatch)
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			httperr.Render(w, httperr.NotFound("invoice not found"))
		case errors.Is(err, ErrVersionMismatch):
			httperr.Render(w, httperr.VersionConflict())
		default:
			httperr.RenderDBErrCtx(r.Context(), w, err)
		}
		return
	}
	httpx.WriteJSON(w, http.StatusOK, DescriptionsUpdatedResponse{RowVersion: v})
}

// validateDescriptions checks and trims lines.
// Each line appears once; an empty description is kept as a cleared one.
func validateDescriptions(lines []LineDescription) map[string]string {
	if len(lines) == 0 {
		return map[string]string{"lines": "Isi deskripsi untuk minimal satu baris."}
	}
	f := validate.Fields{}
	seen := make(map[int64]bool, len(lines))
	for i := range lines {
		key := "lines[" + strconv.Itoa(i) + "]."
		l := &lines[i]
		l.Description = strings.TrimSpace(l.Description)
		switch {
		case l.LineID <= 0:
			f.Add(key+"lineId", "Baris invoice tidak dikenal. Muat ulang halaman.")
		case seen[l.LineID]:
			f.Add(key+"lineId", "Baris ini terkirim dua kali.")
		}
		seen[l.LineID] = true
		if utf8.RuneCountInString(l.Description) > maxDescription {
			f.Add(key+"description", fmt.Sprintf("Deskripsi paling banyak %d karakter.", maxDescription))
		}
	}
	return f.Result()
}
