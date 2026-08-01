package invoices

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
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

// List returns invoices with filter/sort and total count.
func (r *Repo) List(ctx context.Context, f ListFilter) (ListResult, error) {
	args := []any{}
	addArg := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(len(args))
	}
	where := strings.Builder{}
	if f.Q != "" {
		p := addArg("%" + f.Q + "%")
		where.WriteString(" AND (inv.invoice_no ILIKE " + p + " OR q.quotation_no ILIKE " + p + " OR cc.name ILIKE " + p + ")")
	}
	if len(f.Statuses) > 0 {
		p := addArg(f.Statuses)
		where.WriteString(" AND inv.status = ANY(" + p + ")")
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
			where.WriteString(" AND (" + strings.Join(clauses, " OR ") + ")")
		}
	}
	if f.DateFrom != nil {
		p := addArg(*f.DateFrom)
		where.WriteString(" AND inv.invoice_date >= " + p)
	}
	if f.DateTo != nil {
		p := addArg(*f.DateTo)
		where.WriteString(" AND inv.invoice_date <= " + p)
	}
	if f.DueFrom != nil {
		p := addArg(*f.DueFrom)
		where.WriteString(" AND inv.due_date >= " + p)
	}
	if f.DueTo != nil {
		p := addArg(*f.DueTo)
		where.WriteString(" AND inv.due_date <= " + p)
	}
	if f.MinTotal != nil {
		p := addArg(*f.MinTotal)
		where.WriteString(" AND inv.total >= " + p + "::numeric")
	}
	if f.MaxTotal != nil {
		p := addArg(*f.MaxTotal)
		where.WriteString(" AND inv.total <= " + p + "::numeric")
	}

	var out ListResult
	countSQL := r.store.Get("invoices.list_count_base") + where.String()
	if err := r.db.QueryRow(ctx, countSQL, args...).Scan(&out.Total); err != nil {
		return out, err
	}

	sortBy := "inv.id"
	switch f.SortBy {
	case "invoiceDate", "invoice_date":
		sortBy = "inv.invoice_date"
	case "dueDate", "due_date":
		sortBy = "inv.due_date"
	case "total":
		sortBy = "inv.total"
	case "createdAt", "created_at":
		sortBy = "inv.created_at"
	case "invoiceNo", "invoice_no":
		sortBy = "inv.invoice_no"
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
	dataSQL := r.store.Get("invoices.list_base") +
		where.String() +
		" ORDER BY " + sortBy + " " + sortDir +
		" LIMIT " + dataAdd(limit) + " OFFSET " + dataAdd(f.Offset)

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
	return classifyChangeStatusErr(err)
}

// Map P0001 "not found" to ErrNotFound; other P0001 pass through for 422.
func classifyChangeStatusErr(err error) error {
	if err == nil {
		return nil
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "P0001" && strings.Contains(pgErr.Message, "not found") {
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
