package cashentries

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httpx"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/listq"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/paginate"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/sheet"
)

// msgNotFound says the entry is gone.
const msgNotFound = "Catatan kas tidak ditemukan. Muat ulang halaman."

type Handler struct {
	repo *Repo
}

func NewHandler(repo *Repo) *Handler {
	return &Handler{repo: repo}
}

// parseFilter reads list filters.
func parseFilter(r *http.Request) ListFilter {
	q := r.URL.Query()
	return ListFilter{
		Q:         strings.TrimSpace(q.Get("q")),
		Direction: Direction(q.Get("direction")),
		Category:  strings.TrimSpace(q.Get("category")),
		DateFrom:  httpx.ParseDateParam(q.Get("dateFrom")),
		DateTo:    httpx.ParseDateParam(q.Get("dateTo")),
	}
}

// List handles GET /cash-entries.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	f := parseFilter(r)
	f.Limit, f.Offset = paginate.Parse(r)
	res, err := h.repo.List(r.Context(), f)
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	w.Header().Set("X-Total-Count", strconv.FormatInt(res.Total, 10))
	httpx.WriteJSON(w, http.StatusOK, res.Rows)
}

// Summary handles GET /cash-entries/summary.
func (h *Handler) Summary(w http.ResponseWriter, r *http.Request) {
	s, err := h.repo.Summary(r.Context(), parseFilter(r))
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, s)
}

// Categories handles GET /cash-entries/categories.
func (h *Handler) Categories(w http.ResponseWriter, r *http.Request) {
	out, err := h.repo.Categories(r.Context())
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// Get handles GET /cash-entries/{id}.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	h.writeEntry(w, r, id, http.StatusOK)
}

// Create handles POST /cash-entries.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var in EntryInput
	if !httpx.DecodeJSON(w, r, &in) {
		return
	}
	normalize(&in)
	if fields := fieldErrors(in); fields != nil {
		httperr.Render(w, httperr.Unprocessable(fields))
		return
	}
	id, err := h.repo.Create(r.Context(), in, deps.CurrentUserID(r.Context()))
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	h.writeEntry(w, r, id, http.StatusCreated)
}

// Update handles PUT /cash-entries/{id}.
// It needs If-Match with the rowVersion read, so two editors never
// overwrite each other unseen.
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
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
	var in EntryInput
	if !httpx.DecodeJSON(w, r, &in) {
		return
	}
	normalize(&in)
	if fields := fieldErrors(in); fields != nil {
		httperr.Render(w, httperr.Unprocessable(fields))
		return
	}
	err = h.repo.Update(r.Context(), id, in, deps.CurrentUserID(r.Context()), *ifMatch)
	switch {
	case errors.Is(err, ErrNotFound):
		httperr.Render(w, httperr.NotFound(msgNotFound))
		return
	case errors.Is(err, ErrVersionMismatch):
		httperr.Render(w, httperr.VersionConflict())
		return
	case err != nil:
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	h.writeEntry(w, r, id, http.StatusOK)
}

// Delete handles DELETE /cash-entries/{id}.
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	err := h.repo.Delete(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound(msgNotFound))
		return
	}
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Export handles GET /cash-entries/export.xlsx.
// The filtered list goes out whole; Jumlah is a number Excel sums.
func (h *Handler) Export(w http.ResponseWriter, r *http.Request) {
	f := parseFilter(r)
	f.Limit, f.Offset = listq.Unbounded, 0
	res, err := h.repo.List(r.Context(), f)
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	httpx.WarnIfTruncated(r.Context(), "cash_entries.export", res.Total, len(res.Rows))
	headers := []string{"Tanggal", "Jenis", "Kategori", "Keterangan", "Jumlah", "Dicatat Oleh"}
	rows := make([][]string, 0, len(res.Rows))
	for _, e := range res.Rows {
		rows = append(rows, []string{
			e.EntryDate, DirectionLabel(e.Direction), e.Category, e.Description, e.Amount, e.CreatedByName,
		})
	}
	data, err := sheet.Write("Kas Lain", headers, rows, 4)
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	httpx.WriteXLSX(w, "kas-lain", data)
}

// DirectionLabel names a direction.
func DirectionLabel(d Direction) string {
	if d == DirectionIn {
		return "Masuk"
	}
	return "Keluar"
}

// writeEntry answers with one entry.
func (h *Handler) writeEntry(w http.ResponseWriter, r *http.Request, id int64, status int) {
	e, err := h.repo.Get(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound(msgNotFound))
		return
	}
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	httpx.WriteJSON(w, status, e)
}

// pathID reads the {id} segment.
func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return 0, false
	}
	return id, true
}
