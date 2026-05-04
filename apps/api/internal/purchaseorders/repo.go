package purchaseorders

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
)

var (
	ErrNotFound          = errors.New("purchase order not found")
	ErrInvalidTransition = errors.New("invalid PO status transition")
)

type Repo struct {
	db    db.Executor
	store queries.Store
}

func NewRepo(exec db.Executor, store queries.Store) *Repo {
	return &Repo{db: exec, store: store}
}

func (r *Repo) List(ctx context.Context, q *string, status *string, limit, offset int) ([]PurchaseOrder, error) {
	rows, err := r.db.Query(ctx, r.store.Get("purchase_orders.list"), q, status, limit, offset)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[PurchaseOrder])
}

func (r *Repo) GetByID(ctx context.Context, id int64) (PurchaseOrder, error) {
	rows, err := r.db.Query(ctx, r.store.Get("purchase_orders.get_by_id"), id)
	if err != nil {
		return PurchaseOrder{}, err
	}
	po, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[PurchaseOrder])
	if errors.Is(err, pgx.ErrNoRows) {
		return PurchaseOrder{}, ErrNotFound
	}
	return po, err
}

func (r *Repo) GetByQuotation(ctx context.Context, quotationID int64) (PurchaseOrder, error) {
	rows, err := r.db.Query(ctx, r.store.Get("purchase_orders.get_by_quotation"), quotationID)
	if err != nil {
		return PurchaseOrder{}, err
	}
	po, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[PurchaseOrder])
	if errors.Is(err, pgx.ErrNoRows) {
		return PurchaseOrder{}, ErrNotFound
	}
	return po, err
}

func (r *Repo) UpdateFile(ctx context.Context, id int64, req UpdateFileRequest, actorID int64) error {
	tag, err := r.db.Exec(ctx, r.store.Get("purchase_orders.update_file"),
		id, req.FileName, req.FileSize, req.FileURL, actorID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repo) UpdateNotes(ctx context.Context, id int64, notes string, actorID int64) error {
	tag, err := r.db.Exec(ctx, r.store.Get("purchase_orders.update_notes"),
		id, notes, actorID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repo) ChangeStatus(ctx context.Context, id int64, status Status, actorID int64) error {
	_, err := r.db.Exec(ctx, r.store.Get("purchase_orders.change_status"), id, string(status), actorID)
	return classifyChangeStatusErr(err)
}

// PG raise to domain errors.
func classifyChangeStatusErr(err error) error {
	if err == nil {
		return nil
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "P0001" {
		if strings.Contains(pgErr.Message, "not found") {
			return ErrNotFound
		}
		return ErrInvalidTransition
	}
	return err
}
