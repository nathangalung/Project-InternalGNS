package dashboard

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
)

// Metric to query key.
var metricQuery = map[string]string{
	"quotation": "dashboard.ts_quotation",
	"invoice":   "dashboard.ts_invoice",
	"revenue":   "dashboard.ts_revenue",
	"profit":    "dashboard.ts_profit",
	"ppn":       "dashboard.ts_ppn",
}

// ErrUnknownMetric flags bad metric param.
var ErrUnknownMetric = errors.New("unknown metric")

type Repo struct {
	db    db.Executor
	store queries.Store
}

func NewRepo(exec db.Executor, store queries.Store) *Repo {
	return &Repo{db: exec, store: store}
}

// Summary returns aggregate totals.
func (r *Repo) Summary(ctx context.Context) (Summary, error) {
	var s Summary
	rows, err := r.db.Query(ctx, r.store.Get("dashboard.summary"))
	if err != nil {
		return s, err
	}
	return pgx.CollectOneRow(rows, pgx.RowToStructByName[Summary])
}

// Timeseries returns monthly buckets.
func (r *Repo) Timeseries(ctx context.Context, metric string, from, to time.Time) ([]TimeseriesPoint, error) {
	key, ok := metricQuery[metric]
	if !ok {
		return nil, ErrUnknownMetric
	}
	rows, err := r.db.Query(ctx, r.store.Get(key), from, to)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[TimeseriesPoint])
}
