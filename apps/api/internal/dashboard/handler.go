package dashboard

import (
	"errors"
	"net/http"
	"time"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httpx"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/tz"
)

// Default lookback for chart range.
const defaultMonths = 12

type Handler struct {
	repo *Repo
	// now is the clock the default windows read.
	now func() time.Time
}

func NewHandler(repo *Repo) *Handler {
	return &Handler{repo: repo, now: tz.Now}
}

// Summary returns aggregate KPIs.
func (h *Handler) Summary(w http.ResponseWriter, r *http.Request) {
	s, err := h.repo.Summary(r.Context())
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	if !canViewFinancial(deps.CurrentUserRole(r.Context())) {
		s.StripFinancial()
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
	if isFinancialMetric(metric) && !canViewFinancial(deps.CurrentUserRole(r.Context())) {
		httperr.Render(w, httperr.Forbidden("insufficient role"))
		return
	}

	from, to, err := parseRange(h.now(), q.Get("from"), q.Get("to"))
	if err != nil {
		httperr.Render(w, httperr.BadRequest(err.Error()))
		return
	}

	interval := q.Get("interval")
	if interval != "" && interval != "month" && interval != "day" {
		httperr.Render(w, httperr.BadRequest("interval must be month or day"))
		return
	}

	points, err := h.repo.Timeseries(r.Context(), metric, from, to, interval)
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
// The default window is the last defaultMonths months ending with the
// current WIB month, so the new month shows from 00:00 WIB on the 1st.
func parseRange(now time.Time, rawFrom, rawTo string) (time.Time, time.Time, error) {
	to := firstOfNextMonth(now.In(tz.Jakarta()))
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
// Only the calendar date matters: the bound is sent as a SQL date.
func firstOfNextMonth(t time.Time) time.Time {
	y, m, _ := t.Date()
	return time.Date(y, m+1, 1, 0, 0, 0, 0, time.UTC)
}

// Roles allowed financial figures.
func canViewFinancial(role string) bool {
	return role == "superadmin" || role == "finance"
}

// Finance-only timeseries metrics.
func isFinancialMetric(metric string) bool {
	switch metric {
	case "revenue", "profit", "ppn", "invoice":
		return true
	default:
		return false
	}
}
