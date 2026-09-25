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

// poTotalExpr is the PO total.
// It is the PO's own grand total. The list column, the total filter, the
// sort and the export all read it, so a PO edited after acceptance is
// ranked by what it will bill.
const poTotalExpr = "COALESCE(t.po_grand_total, 0)"

// sortable lists PO sort keys.
var sortable = listq.Whitelist{
	Default: "po_date",
	Columns: map[string]listq.Column{
		"poDate":     {Expr: "po.po_date", Dir: listq.Desc},
		"po_date":    {Expr: "po.po_date", Dir: listq.Desc},
		"createdAt":  {Expr: "po.created_at", Dir: listq.Desc},
		"created_at": {Expr: "po.created_at", Dir: listq.Desc},
		"total":      {Expr: poTotalExpr, Dir: listq.Desc},
		"poNumber":   {Expr: "po.po_number", Dir: listq.Desc},
		"po_number":  {Expr: "po.po_number", Dir: listq.Desc},
	},
}

// tiebreak keeps paging stable.
var tiebreak = listq.Column{Expr: "po.id", Dir: listq.Desc}

// List pages POs with total.
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
		c.And(poTotalExpr + " >= " + p + "::numeric")
	}
	if f.MaxTotal != nil {
		p := c.Arg(*f.MaxTotal)
		c.And(poTotalExpr + " <= " + p + "::numeric")
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
	for i := range out.Rows {
		out.Rows[i].withTransitions()
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
	po.withTransitions()
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
	po.withTransitions()
	return po, err
}

// UpdateFile attaches the PO document.
// A PENDING PO becomes UPLOADED.
func (r *Repo) UpdateFile(ctx context.Context, id int64, req UpdateFileRequest, actorID int64) error {
	_, err := r.db.Exec(ctx, r.store.Get("purchase_orders.update_file"),
		id, req.FileName, req.FileSize, req.ObjectKey, actorID)
	return classifyPgErr(err)
}

// RemoveFile detaches the PO document.
// An UPLOADED PO returns to PENDING.
// Once work has started the file stays, reported as ErrLocked.
func (r *Repo) RemoveFile(ctx context.Context, id, actorID int64) error {
	_, err := r.db.Exec(ctx, r.store.Get("purchase_orders.remove_file"), id, actorID)
	return classifyPgErr(err)
}

// History returns the status timeline.
// It runs oldest first. Every PO has its creation entry, so an empty
// timeline means the PO does not exist.
func (r *Repo) History(ctx context.Context, id int64) ([]StatusHistoryEntry, error) {
	rows, err := r.db.Query(ctx, r.store.Get("purchase_orders.status_history"), id)
	if err != nil {
		return nil, fmt.Errorf("query po history: %w", err)
	}
	out, err := pgx.CollectRows(rows, pgx.RowToStructByName[StatusHistoryEntry])
	if err != nil {
		return nil, fmt.Errorf("scan po history: %w", err)
	}
	if len(out) == 0 {
		return nil, ErrNotFound
	}
	return out, nil
}

// UpdateNotes rewrites the internal note.
// ifMatch nil skips the optimistic-lock guard.
func (r *Repo) UpdateNotes(ctx context.Context, id int64, notes string, actorID int64, ifMatch *int32) error {
	_, err := r.db.Exec(ctx, r.store.Get("purchase_orders.update_notes"),
		id, ifMatch, notes, actorID)
	return classifyPgErr(err)
}

// UpdateDetails rewrites PO number, date.
// Both are the client's PO number and date.
// ifMatch nil skips the optimistic-lock guard; a filed invoice locks both
// fields, which the function reports as ErrLocked.
func (r *Repo) UpdateDetails(
	ctx context.Context, id int64, poNumber string, poDate time.Time, actorID int64, ifMatch *int32,
) error {
	_, err := r.db.Exec(ctx, r.store.Get("purchase_orders.update_details"),
		id, ifMatch, poNumber, poDate, actorID)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return ErrDuplicatePoNumber
		}
		return classifyPgErr(err)
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

// Completeness lists ON_PROGRESS blockers.
// Each is a client, vendor or line gap.
// An empty slice means the PO may be worked on.
func (r *Repo) Completeness(ctx context.Context, poID int64) ([]CompletenessIssue, error) {
	rows, err := r.db.Query(ctx, r.store.Get("purchase_orders.completeness_client"), poID)
	if err != nil {
		return nil, fmt.Errorf("query client completeness: %w", err)
	}
	client, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[ClientCompleteness])
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("scan client completeness: %w", err)
	}

	vendorRows, err := r.db.Query(ctx, r.store.Get("purchase_orders.completeness_vendors"), poID)
	if err != nil {
		return nil, fmt.Errorf("query vendor completeness: %w", err)
	}
	vendors, err := pgx.CollectRows(vendorRows, pgx.RowToStructByName[VendorCompleteness])
	if err != nil {
		return nil, fmt.Errorf("scan vendor completeness: %w", err)
	}

	lineRows, err := r.db.Query(ctx, r.store.Get("purchase_orders.completeness_lines"), poID)
	if err != nil {
		return nil, fmt.Errorf("query line completeness: %w", err)
	}
	lines, err := pgx.CollectRows(lineRows, pgx.RowToStructByName[LineCompleteness])
	if err != nil {
		return nil, fmt.Errorf("scan line completeness: %w", err)
	}

	var issues []CompletenessIssue
	if missing := missingClientFields(client); len(missing) > 0 {
		issues = append(issues, CompletenessIssue{
			Scope: scopeClient, ID: client.ID, Name: client.Name, Missing: missing,
		})
	}
	for _, v := range vendors {
		if missing := missingVendorFields(v); len(missing) > 0 {
			issues = append(issues, CompletenessIssue{
				Scope: scopeVendor, ID: v.ID, Name: v.Name, Missing: missing,
			})
		}
	}
	return append(issues, lineIssues(lines)...), nil
}

// ChangeStatus transitions without note.
func (r *Repo) ChangeStatus(ctx context.Context, id int64, status Status, actorID int64) error {
	return r.Transition(ctx, id, status, "", actorID)
}

// Transition moves and records history.
// The note goes into the PO's history.
// CANCELLED requires a non-blank note.
func (r *Repo) Transition(ctx context.Context, id int64, status Status, note string, actorID int64) error {
	_, err := r.db.Exec(ctx, r.store.Get("purchase_orders.change_status"),
		id, string(status), actorID, note)
	return classifyPgErr(err)
}

// ruleError wraps user-facing raises.
// It carries the raise message under a domain sentinel.
type ruleError struct {
	kind error
	msg  string
}

func (e *ruleError) Error() string { return e.msg }
func (e *ruleError) Unwrap() error { return e.kind }

// classifyPgErr maps ERRCODEs to errors.
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
	// The raise message is the reason, which differs per guard.
	case "P0012":
		return &ruleError{kind: ErrInvalidTransition, msg: pgErr.Message}
	case "P0013":
		return &ruleError{kind: ErrLocked, msg: pgErr.Message}
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
