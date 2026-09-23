package dashboard

import (
	"context"
	"errors"
	"fmt"
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

// Summary returns totals and tiles.
func (r *Repo) Summary(ctx context.Context) (Summary, error) {
	rows, err := r.db.Query(ctx, r.store.Get("dashboard.summary"))
	if err != nil {
		return Summary{}, fmt.Errorf("dashboard summary: %w", err)
	}
	s, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[Summary])
	if err != nil {
		return Summary{}, fmt.Errorf("dashboard summary: %w", err)
	}
	counts, err := r.statusCounts(ctx)
	if err != nil {
		return Summary{}, err
	}
	s.QuotationStatuses = fold(quotationTiles, counts["quotation"])
	s.PoStatuses = fold(poTiles, counts["purchase_order"])
	s.InvoiceStatuses = fold(invoiceTiles(), counts["invoice"])
	return s, nil
}

// statusCounts groups counts by entity.
func (r *Repo) statusCounts(ctx context.Context) (map[string]map[string]int64, error) {
	rows, err := r.db.Query(ctx, r.store.Get("dashboard.status_counts"))
	if err != nil {
		return nil, fmt.Errorf("dashboard status counts: %w", err)
	}
	defer rows.Close()
	out := map[string]map[string]int64{}
	for rows.Next() {
		var entity, status string
		var n int64
		if err := rows.Scan(&entity, &status, &n); err != nil {
			return nil, fmt.Errorf("dashboard status counts: %w", err)
		}
		if out[entity] == nil {
			out[entity] = map[string]int64{}
		}
		out[entity][status] += n
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("dashboard status counts: %w", err)
	}
	return out, nil
}

// Timeseries returns metric buckets by interval.
func (r *Repo) Timeseries(ctx context.Context, metric string, from, to time.Time, interval string) ([]TimeseriesPoint, error) {
	key, ok := metricQuery[metric]
	if !ok {
		return nil, ErrUnknownMetric
	}
	if interval != "day" {
		interval = "month"
	}
	rows, err := r.db.Query(ctx, r.store.Get(key), from, to, interval)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[TimeseriesPoint])
}
