package purchaseorders

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/listq"
)

var (
	ErrNotFound          = errors.New("purchase order not found")
	ErrInvalidTransition = errors.New("invalid PO status transition")
	ErrLocked            = errors.New("purchase order locked")
	ErrVersionMismatch   = errors.New("purchase order version mismatch")
	ErrDuplicatePoNumber = errors.New("po_number already exists")
)

type Repo struct {
	db    db.Executor
	store queries.Store
}

func NewRepo(exec db.Executor, store queries.Store) *Repo {
	return &Repo{db: exec, store: store}
}

// sortable is the closed set of PO sort keys.
var sortable = listq.Whitelist{
	Default: "po_date",
	Columns: map[string]listq.Column{
		"poDate":     {Expr: "po.po_date", Dir: listq.Desc},
		"po_date":    {Expr: "po.po_date", Dir: listq.Desc},
		"createdAt":  {Expr: "po.created_at", Dir: listq.Desc},
		"created_at": {Expr: "po.created_at", Dir: listq.Desc},
		"total":      {Expr: "COALESCE(q.grand_total, 0)", Dir: listq.Desc},
		"poNumber":   {Expr: "po.po_number", Dir: listq.Desc},
		"po_number":  {Expr: "po.po_number", Dir: listq.Desc},
	},
}

// tiebreak keeps paging stable when the sort key ties.
var tiebreak = listq.Column{Expr: "po.id", Dir: listq.Desc}

// List returns POs with filter/sort and total count.
func (r *Repo) List(ctx context.Context, f ListFilter) (ListResult, error) {
	c := listq.New()
	if f.Q != "" {
		p := c.Arg("%" + f.Q + "%")
		c.And("(po.po_number ILIKE " + p + " OR q.quotation_no ILIKE " + p + " OR cc.name ILIKE " + p + ")")
	}
	if len(f.Statuses) > 0 {
		p := c.Arg(f.Statuses)
		c.And("po.status = ANY(" + p + ")")
	}
	if f.DateFrom != nil {
		p := c.Arg(*f.DateFrom)
		c.And("po.po_date >= " + p)
	}
	if f.DateTo != nil {
		p := c.Arg(*f.DateTo)
		c.And("po.po_date <= " + p)
	}
	if f.MinTotal != nil {
		p := c.Arg(*f.MinTotal)
		c.And("COALESCE(q.grand_total, 0) >= " + p + "::numeric")
	}
	if f.MaxTotal != nil {
		p := c.Arg(*f.MaxTotal)
		c.And("COALESCE(q.grand_total, 0) <= " + p + "::numeric")
	}

	var out ListResult
	countSQL, countArgs := c.Count(r.store.Get("purchase_orders.list_count_base"))
	if err := r.db.QueryRow(ctx, countSQL, countArgs...).Scan(&out.Total); err != nil {
		return out, err
	}

	dataSQL, dataArgs := c.Data(
		r.store.Get("purchase_orders.list_base"),
		listq.OrderBy(sortable, f.SortBy, f.SortDir, tiebreak),
		listq.Page(f.Limit, f.Offset),
	)

	rows, err := r.db.Query(ctx, dataSQL, dataArgs...)
	if err != nil {
		return out, err
	}
	out.Rows, err = pgx.CollectRows(rows, pgx.RowToStructByName[PurchaseOrder])
	if out.Rows == nil {
		out.Rows = []PurchaseOrder{}
	}
	return out, err
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
		id, req.FileName, req.FileSize, req.ObjectKey, actorID)
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

func (r *Repo) UpdateDetails(ctx context.Context, id int64, poNumber string, poDate time.Time, actorID int64) error {
	tag, err := r.db.Exec(ctx, r.store.Get("purchase_orders.update_details"),
		id, poNumber, poDate, actorID)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return ErrDuplicatePoNumber
		}
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repo) ListItems(ctx context.Context, poID int64) ([]PurchaseOrderItem, error) {
	rows, err := r.db.Query(ctx, r.store.Get("purchase_orders.list_items"), poID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[PurchaseOrderItem])
}

func (r *Repo) ChangeStatus(ctx context.Context, id int64, status Status, actorID int64) error {
	_, err := r.db.Exec(ctx, r.store.Get("purchase_orders.change_status"), id, string(status), actorID)
	return classifyPgErr(err)
}

// Single ERRCODE to domain error table for this slice.
// Codes are assigned by migration 00046; P0014 validation raises pass
// through so httperr renders them as 422 with the raise message.
func classifyPgErr(err error) error {
	if err == nil {
		return nil
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}
	switch pgErr.Code {
	case "P0010":
		return ErrVersionMismatch
	case "P0011":
		return ErrNotFound
	case "P0012":
		return ErrInvalidTransition
	case "P0013":
		// Wrapped so the caller can surface the real reason, which differs
		// per guard (DELIVERED edit lock vs. existing invoice).
		return fmt.Errorf("%w: %s", ErrLocked, pgErr.Message)
	}
	return err
}

// UpdateItems wholesale-replaces PO lines.
// ifMatch nil skips optimistic-lock guard (legacy callers / tests).
// Returns new row_version; DB raises are mapped by classifyPgErr.
func (r *Repo) UpdateItems(
	ctx context.Context, id int64, req UpdateItemsRequest, actorID int64, ifMatch *int32,
) (int32, error) {
	items := req.Items
	if items == nil {
		items = []UpdateItemsLine{}
	}
	payload, err := json.Marshal(items)
	if err != nil {
		return 0, err
	}

	if ifMatch == nil {
		_, err = r.db.Exec(ctx, r.store.Get("purchase_orders.update_items"),
			id, actorID, req.DiscountPct, req.Notes, req.ShippingAddress, req.ShippingDays, req.ShippingCost, payload)
		if err != nil {
			return 0, classifyPgErr(err)
		}
		var rv int32
		if err = r.db.QueryRow(ctx, r.store.Get("purchase_orders.row_version"), id).Scan(&rv); err != nil {
			return 0, err
		}
		return rv, nil
	}

	var newVersion int32
	err = r.db.QueryRow(ctx, r.store.Get("purchase_orders.update_items_versioned"),
		id, *ifMatch, actorID, req.DiscountPct, req.Notes,
		req.ShippingAddress, req.ShippingDays, req.ShippingCost, payload,
	).Scan(&newVersion)
	if err != nil {
		return 0, classifyPgErr(err)
	}
	return newVersion, nil
}
