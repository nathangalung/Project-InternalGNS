package purchaseorders

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
)

var (
	ErrNotFound            = errors.New("purchase order not found")
	ErrInvalidTransition   = errors.New("invalid PO status transition")
	ErrLocked              = errors.New("purchase order locked")
	ErrVersionMismatch     = errors.New("purchase order version mismatch")
	ErrDuplicatePoNumber   = errors.New("po_number already exists")
)

type Repo struct {
	db    db.Executor
	store queries.Store
}

func NewRepo(exec db.Executor, store queries.Store) *Repo {
	return &Repo{db: exec, store: store}
}

// List returns POs with filter/sort and total count.
func (r *Repo) List(ctx context.Context, f ListFilter) (ListResult, error) {
	args := []any{}
	addArg := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(len(args))
	}
	where := strings.Builder{}
	if f.Q != "" {
		p := addArg("%" + f.Q + "%")
		where.WriteString(" AND (po.po_number ILIKE " + p + " OR q.quotation_no ILIKE " + p + " OR cc.name ILIKE " + p + ")")
	}
	if len(f.Statuses) > 0 {
		p := addArg(f.Statuses)
		where.WriteString(" AND po.status = ANY(" + p + ")")
	}
	if f.DateFrom != nil {
		p := addArg(*f.DateFrom)
		where.WriteString(" AND po.po_date >= " + p)
	}
	if f.DateTo != nil {
		p := addArg(*f.DateTo)
		where.WriteString(" AND po.po_date <= " + p)
	}
	if f.MinTotal != nil {
		p := addArg(*f.MinTotal)
		where.WriteString(" AND COALESCE(s.po_subtotal, 0) >= " + p + "::numeric")
	}
	if f.MaxTotal != nil {
		p := addArg(*f.MaxTotal)
		where.WriteString(" AND COALESCE(s.po_subtotal, 0) <= " + p + "::numeric")
	}

	var out ListResult
	countSQL := r.store.Get("purchase_orders.list_count_base") + where.String()
	if err := r.db.QueryRow(ctx, countSQL, args...).Scan(&out.Total); err != nil {
		return out, err
	}

	sortBy := "po.po_date"
	switch f.SortBy {
	case "poDate", "po_date":
		sortBy = "po.po_date"
	case "createdAt", "created_at":
		sortBy = "po.created_at"
	case "total":
		sortBy = "COALESCE(s.po_subtotal, 0)"
	case "poNumber", "po_number":
		sortBy = "po.po_number"
	}
	sortDir := "DESC"
	if strings.EqualFold(f.SortDir, "asc") {
		sortDir = "ASC"
	}

	dataArgs := append([]any{}, args...)
	dataAdd := func(v any) string {
		dataArgs = append(dataArgs, v)
		return "$" + strconv.Itoa(len(dataArgs))
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	dataSQL := r.store.Get("purchase_orders.list_base") +
		where.String() +
		" ORDER BY " + sortBy + " " + sortDir + ", po.id DESC" +
		" LIMIT " + dataAdd(limit) + " OFFSET " + dataAdd(f.Offset)

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

// UpdateItems wholesale-replaces PO lines.
// ifMatch nil skips optimistic-lock guard (legacy callers / tests).
// Returns new row_version. Maps P0010 -> ErrVersionMismatch, P0011 -> ErrNotFound.
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
			return 0, classifyUpdateItemsErr(err)
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
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) {
			switch pgErr.Code {
			case "P0010":
				return 0, ErrVersionMismatch
			case "P0011":
				return 0, ErrNotFound
			}
		}
		return 0, classifyUpdateItemsErr(err)
	}
	return newVersion, nil
}

// Map P0001 to ErrNotFound/ErrLocked/passthrough.
func classifyUpdateItemsErr(err error) error {
	if err == nil {
		return nil
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "P0001" {
		msg := pgErr.Message
		switch {
		case strings.Contains(msg, "not found"):
			return ErrNotFound
		case strings.Contains(msg, "DELIVERED"):
			return ErrLocked
		}
	}
	return err
}
