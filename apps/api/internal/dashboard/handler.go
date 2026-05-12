package dashboard

import (
	"errors"
	"net/http"
	"time"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httpx"
)

// Default lookback for chart range.
const defaultMonths = 12

type Handler struct {
	repo *Repo
}

func NewHandler(repo *Repo) *Handler {
	return &Handler{repo: repo}
}

// Summary returns aggregate KPIs.
func (h *Handler) Summary(w http.ResponseWriter, r *http.Request) {
	s, err := h.repo.Summary(r.Context())
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, s)
}

// Timeseries returns monthly metric buckets.
func (h *Handler) Timeseries(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	metric := q.Get("metric")
	if metric == "" {
		httperr.Render(w, httperr.BadRequest("metric required"))
		return
	}

	from, to, err := parseRange(q.Get("from"), q.Get("to"))
	if err != nil {
		httperr.Render(w, httperr.BadRequest(err.Error()))
		return
	}

	points, err := h.repo.Timeseries(r.Context(), metric, from, to)
	if errors.Is(err, ErrUnknownMetric) {
		httperr.Render(w, httperr.BadRequest("unknown metric"))
		return
	}
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, points)
}

// parseRange returns inclusive-from exclusive-to.
func parseRange(rawFrom, rawTo string) (time.Time, time.Time, error) {
	now := time.Now().UTC()
	to := firstOfNextMonth(now)
	from := to.AddDate(0, -defaultMonths, 0)

	if rawFrom != "" {
		t, err := time.Parse("2006-01-02", rawFrom)
		if err != nil {
			return time.Time{}, time.Time{}, errors.New("invalid from date")
		}
		from = t
	}
	if rawTo != "" {
		t, err := time.Parse("2006-01-02", rawTo)
		if err != nil {
			return time.Time{}, time.Time{}, errors.New("invalid to date")
		}
		to = t
	}
	if !to.After(from) {
		return time.Time{}, time.Time{}, errors.New("to must be after from")
	}
	return from, to, nil
}

// firstOfNextMonth marks exclusive upper bound.
func firstOfNextMonth(t time.Time) time.Time {
	y, m, _ := t.Date()
	return time.Date(y, m+1, 1, 0, 0, 0, 0, time.UTC)
}
