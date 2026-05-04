package invoices

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
)

var ErrNotFound = errors.New("invoice not found")

type Repo struct {
	db    db.Executor
	store queries.Store
}

func NewRepo(exec db.Executor, store queries.Store) *Repo {
	return &Repo{db: exec, store: store}
}

func (r *Repo) List(ctx context.Context, q *string, status *string, limit, offset int) ([]Invoice, error) {
	rows, err := r.db.Query(ctx, r.store.Get("invoices.list"), q, status, limit, offset)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[Invoice])
}

func (r *Repo) GetByID(ctx context.Context, id int64) (Invoice, error) {
	rows, err := r.db.Query(ctx, r.store.Get("invoices.get_by_id"), id)
	if err != nil {
		return Invoice{}, err
	}
	inv, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[Invoice])
	if errors.Is(err, pgx.ErrNoRows) {
		return Invoice{}, ErrNotFound
	}
	return inv, err
}

func (r *Repo) GetByQuotation(ctx context.Context, quotationID int64) (Invoice, error) {
	rows, err := r.db.Query(ctx, r.store.Get("invoices.get_by_quotation"), quotationID)
	if err != nil {
		return Invoice{}, err
	}
	inv, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[Invoice])
	if errors.Is(err, pgx.ErrNoRows) {
		return Invoice{}, ErrNotFound
	}
	return inv, err
}

func (r *Repo) ChangeStatus(ctx context.Context, id int64, status Status, actorID int64) error {
	tag, err := r.db.Exec(ctx, r.store.Get("invoices.change_status"), id, string(status), actorID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repo) Summary(ctx context.Context) (Summary, error) {
	rows, err := r.db.Query(ctx, r.store.Get("invoices.summary"))
	if err != nil {
		return Summary{}, err
	}
	return pgx.CollectOneRow(rows, pgx.RowToStructByName[Summary])
}

func (r *Repo) UpdateDates(ctx context.Context, id int64, req UpdateDatesRequest, actorID int64) error {
	tag, err := r.db.Exec(ctx, r.store.Get("invoices.update_dates"),
		id, req.InvoiceDate, req.DueDate, actorID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
