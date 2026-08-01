package invoices

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/listq"
)

var (
	ErrNotFound        = errors.New("invoice not found")
	ErrVersionMismatch = errors.New("invoice version mismatch")
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
	if len(f.EffectiveStatuses) > 0 {
		clauses := []string{}
		for _, s := range f.EffectiveStatuses {
			switch s {
			case "draft":
				clauses = append(clauses, "(inv.status = 'draft' AND (inv.due_date IS NULL OR inv.due_date >= CURRENT_DATE))")
			case "sent":
				clauses = append(clauses, "(inv.status = 'sent' AND (inv.due_date IS NULL OR inv.due_date >= CURRENT_DATE))")
			case "paid":
				clauses = append(clauses, "inv.status = 'paid'")
			case "overdue":
				clauses = append(clauses, "(inv.status = 'overdue' OR (inv.status IN ('draft','sent') AND inv.due_date IS NOT NULL AND inv.due_date < CURRENT_DATE))")
			}
		}
		if len(clauses) > 0 {
			c.And("(" + strings.Join(clauses, " OR ") + ")")
		}
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

func (r *Repo) ListItems(ctx context.Context, invoiceID int64) ([]InvoiceItem, error) {
	rows, err := r.db.Query(ctx, r.store.Get("invoices.list_items"), invoiceID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[InvoiceItem])
}

func (r *Repo) ChangeStatus(ctx context.Context, id int64, status Status, actorID int64) error {
	_, err := r.db.Exec(ctx, r.store.Get("invoices.change_status"), id, string(status), actorID)
	return classifyPgErr(err)
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
// Returns new row_version on success; ErrVersionMismatch when ifMatch stale; ErrNotFound when row gone.
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
	// Disambiguate 404 vs 409.
	var existing int32
	probeErr := r.db.QueryRow(ctx, r.store.Get("invoices.row_version"), id).Scan(&existing)
	if errors.Is(probeErr, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	if probeErr != nil {
		return 0, probeErr
	}
	return 0, ErrVersionMismatch
}
