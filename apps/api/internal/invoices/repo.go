package invoices

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/listq"
)

var (
	ErrNotFound         = errors.New("invoice not found")
	ErrVersionMismatch  = errors.New("invoice version mismatch")
	ErrDatesLocked      = errors.New("invoice dates locked")
	ErrDueBeforeInvoice = errors.New("invoice due date before invoice date")
	ErrOverdueDerived   = errors.New("invoice overdue is derived from the due date")
)

type Repo struct {
	db    db.Executor
	store queries.Store
}

func NewRepo(exec db.Executor, store queries.Store) *Repo {
	return &Repo{db: exec, store: store}
}

// sortable is the closed set of invoice sort keys.
var sortable = listq.Whitelist{
	Default: "id",
	Columns: map[string]listq.Column{
		"id":           {Expr: "inv.id", Dir: listq.Desc},
		"invoiceDate":  {Expr: "inv.invoice_date", Dir: listq.Desc},
		"invoice_date": {Expr: "inv.invoice_date", Dir: listq.Desc},
		"dueDate":      {Expr: "inv.due_date", Dir: listq.Desc},
		"due_date":     {Expr: "inv.due_date", Dir: listq.Desc},
		"total":        {Expr: "inv.total", Dir: listq.Desc},
		"createdAt":    {Expr: "inv.created_at", Dir: listq.Desc},
		"created_at":   {Expr: "inv.created_at", Dir: listq.Desc},
		"invoiceNo":    {Expr: "inv.invoice_no", Dir: listq.Desc},
		"invoice_no":   {Expr: "inv.invoice_no", Dir: listq.Desc},
	},
}

// tiebreak keeps paging stable when the sort key ties.
var tiebreak = listq.Column{Expr: "inv.id", Dir: listq.Desc}

// filterableEffective keeps the known values.
// Cancelled is not an effective-status filter; unknown values are ignored
// rather than matching nothing.
func filterableEffective(raw []string) []string {
	out := make([]string, 0, len(raw))
	for _, s := range raw {
		switch Status(s) {
		case StatusDraft, StatusSent, StatusPaid, StatusOverdue:
			out = append(out, s)
		}
	}
	return out
}

// List returns invoices with filter/sort and total count.
func (r *Repo) List(ctx context.Context, f ListFilter) (ListResult, error) {
	c := listq.New()
	if f.Q != "" {
		p := c.Arg("%" + f.Q + "%")
		c.And("(inv.invoice_no ILIKE " + p + " OR q.quotation_no ILIKE " + p + " OR cc.name ILIKE " + p + ")")
	}
	if len(f.Statuses) > 0 {
		p := c.Arg(f.Statuses)
		c.And("inv.status = ANY(" + p + ")")
	}
	if effective := filterableEffective(f.EffectiveStatuses); len(effective) > 0 {
		p := c.Arg(effective)
		c.And("fn_invoice_effective_status(inv.status, inv.due_date) = ANY(" + p + ")")
	}
	if f.DateFrom != nil {
		p := c.Arg(*f.DateFrom)
		c.And("inv.invoice_date >= " + p)
	}
	if f.DateTo != nil {
		p := c.Arg(*f.DateTo)
		c.And("inv.invoice_date <= " + p)
	}
	if f.DueFrom != nil {
		p := c.Arg(*f.DueFrom)
		c.And("inv.due_date >= " + p)
	}
	if f.DueTo != nil {
		p := c.Arg(*f.DueTo)
		c.And("inv.due_date <= " + p)
	}
	if f.MinTotal != nil {
		p := c.Arg(*f.MinTotal)
		c.And("inv.total >= " + p + "::numeric")
	}
	if f.MaxTotal != nil {
		p := c.Arg(*f.MaxTotal)
		c.And("inv.total <= " + p + "::numeric")
	}

	var out ListResult
	countSQL, countArgs := c.Count(r.store.Get("invoices.list_count_base"))
	if err := r.db.QueryRow(ctx, countSQL, countArgs...).Scan(&out.Total); err != nil {
		return out, err
	}

	dataSQL, dataArgs := c.Data(
		r.store.Get("invoices.list_base"),
		listq.OrderBy(sortable, f.SortBy, f.SortDir, tiebreak),
		listq.Page(f.Limit, f.Offset),
	)

	rows, err := r.db.Query(ctx, dataSQL, dataArgs...)
	if err != nil {
		return out, err
	}
	out.Rows, err = pgx.CollectRows(rows, pgx.RowToStructByName[Invoice])
	if out.Rows == nil {
		out.Rows = []Invoice{}
	}
	return out, err
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

// GetDetail returns the invoice with its client, quotation and PO header.
func (r *Repo) GetDetail(ctx context.Context, id int64) (InvoiceDetail, error) {
	return r.detail(ctx, "invoices.get_detail_by_id", id)
}

// GetDetailByQuotation is GetDetail keyed by the quotation the screen routes on.
func (r *Repo) GetDetailByQuotation(ctx context.Context, quotationID int64) (InvoiceDetail, error) {
	return r.detail(ctx, "invoices.get_detail_by_quotation", quotationID)
}

func (r *Repo) detail(ctx context.Context, query string, id int64) (InvoiceDetail, error) {
	rows, err := r.db.Query(ctx, r.store.Get(query), id)
	if err != nil {
		return InvoiceDetail{}, err
	}
	det, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[InvoiceDetail])
	if errors.Is(err, pgx.ErrNoRows) {
		return InvoiceDetail{}, ErrNotFound
	}
	if err != nil {
		return InvoiceDetail{}, err
	}
	det.AllowedTransitions = AllowedTransitions(det.Status, det.PoID != nil)
	det.CanReplace = det.Status == StatusCancelled && det.PoID != nil && det.ReplacedByInvoiceID == nil
	det.History, err = r.History(ctx, det.ID)
	if err != nil {
		return InvoiceDetail{}, err
	}
	return det, nil
}

// History returns the timeline.
// Oldest entry first.
func (r *Repo) History(ctx context.Context, invoiceID int64) ([]StatusHistoryEntry, error) {
	rows, err := r.db.Query(ctx, r.store.Get("invoices.history"), invoiceID)
	if err != nil {
		return nil, fmt.Errorf("invoice history: %w", err)
	}
	out, err := pgx.CollectRows(rows, pgx.RowToStructByName[StatusHistoryEntry])
	if err != nil {
		return nil, fmt.Errorf("invoice history: %w", err)
	}
	if out == nil {
		out = []StatusHistoryEntry{}
	}
	return out, nil
}

func (r *Repo) ListItems(ctx context.Context, invoiceID int64) ([]InvoiceItem, error) {
	rows, err := r.db.Query(ctx, r.store.Get("invoices.list_items"), invoiceID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[InvoiceItem])
}

// ListItemsBulk groups the line items of many invoices in one round-trip.
// Invoices with no lines are absent from the map, matching what ListItems
// returns empty for.
func (r *Repo) ListItemsBulk(ctx context.Context, ids []int64) (map[int64][]InvoiceItem, error) {
	out := map[int64][]InvoiceItem{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := r.db.Query(ctx, r.store.Get("invoices.list_items_bulk"), ids)
	if err != nil {
		return nil, err
	}
	items, err := pgx.CollectRows(rows, pgx.RowToStructByName[InvoiceItem])
	if err != nil {
		return nil, err
	}
	for _, it := range items {
		out[it.InvoiceID] = append(out[it.InvoiceID], it)
	}
	return out, nil
}

// ChangeStatus applies a legal transition.
// The reason and the proof key ride along.
func (r *Repo) ChangeStatus(ctx context.Context, id int64, req ChangeStatusRequest, actorID int64) error {
	// Overdue is never stored by hand: it only confirms what the due date
	// already says, so a past-due request is a no-op and an early one fails.
	if req.Status == StatusOverdue {
		return r.confirmOverdue(ctx, id)
	}
	_, err := r.db.Exec(ctx, r.store.Get("invoices.change_status"),
		id, string(req.Status), actorID, req.Note, req.PaymentProofKey)
	return classifyPgErr(err)
}

// Replace issues a Pengganti invoice.
func (r *Repo) Replace(ctx context.Context, cancelledID int64, actorID int64) (InvoiceDetail, error) {
	var newID int64
	err := r.db.QueryRow(ctx, r.store.Get("invoices.replace"), cancelledID, actorID).Scan(&newID)
	if err != nil {
		return InvoiceDetail{}, classifyPgErr(err)
	}
	return r.GetDetail(ctx, newID)
}

// confirmOverdue checks the due date.
func (r *Repo) confirmOverdue(ctx context.Context, id int64) error {
	var overdue bool
	err := r.db.QueryRow(ctx, r.store.Get("invoices.is_overdue"), id).Scan(&overdue)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("invoice overdue probe: %w", err)
	}
	if !overdue {
		return ErrOverdueDerived
	}
	return nil
}

// Single ERRCODE to domain error table for this slice.
// Codes are assigned by migration 00046; P0012 invalid transitions and P0014
// validation raises pass through so httperr renders them as 422 with the
// raise message, which is what the invoice contract already returned.
func classifyPgErr(err error) error {
	if err == nil {
		return nil
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "P0011" {
		return ErrNotFound
	}
	return err
}

func (r *Repo) Summary(ctx context.Context) (Summary, error) {
	rows, err := r.db.Query(ctx, r.store.Get("invoices.summary"))
	if err != nil {
		return Summary{}, err
	}
	return pgx.CollectOneRow(rows, pgx.RowToStructByName[Summary])
}

// UpdateAttachment writes the MinIO object key for an invoice attachment.
// No row_version guard — attachments are administrative metadata, not part
// of the invoice numbers contract.
func (r *Repo) UpdateAttachment(ctx context.Context, id int64, objectKey string, actorID int64) error {
	tag, err := r.db.Exec(ctx, r.store.Get("invoices.update_attachment"), id, objectKey, actorID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// UpdateDates writes dates with optimistic-lock guard via row_version.
// Returns new row_version on success. A refusal reports, in order,
// ErrNotFound when the row is gone, ErrDatesLocked when the invoice is filed,
// ErrDueBeforeInvoice when the due date would precede the invoice date, and
// ErrVersionMismatch when ifMatch is stale.
func (r *Repo) UpdateDates(ctx context.Context, id int64, req UpdateDatesRequest, actorID int64, ifMatch *int32) (int32, error) {
	var newVersion int32
	err := r.db.QueryRow(ctx, r.store.Get("invoices.update_dates"),
		id, req.InvoiceDate, req.DueDate, actorID, ifMatch,
	).Scan(&newVersion)
	if err == nil {
		return newVersion, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return 0, err
	}
	// Disambiguate 404 vs 422 vs 409.
	var (
		status     Status
		existing   int32
		misordered bool
	)
	probeErr := r.db.QueryRow(ctx, r.store.Get("invoices.status_and_version"),
		id, req.InvoiceDate, req.DueDate,
	).Scan(&status, &existing, &misordered)
	if errors.Is(probeErr, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	if probeErr != nil {
		return 0, probeErr
	}
	if !isDateEditable(status) {
		return 0, ErrDatesLocked
	}
	if misordered {
		return 0, ErrDueBeforeInvoice
	}
	return 0, ErrVersionMismatch
}

// isDateEditable mirrors the guard in invoices.update_dates.
func isDateEditable(s Status) bool {
	return s != StatusPaid && s != StatusCancelled
}
