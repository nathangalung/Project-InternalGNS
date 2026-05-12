package quotations

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	dbpkg "github.com/nathangalung/internalgns/apps/api/internal/shared/db"
)

// Executor aliased for backwards compat.
type Executor = dbpkg.Executor

type Repo struct {
	db    Executor
	store queries.Store
}

func NewRepo(db Executor, store queries.Store) *Repo {
	return &Repo{db: db, store: store}
}

var (
	ErrNotFound        = errors.New("not found")
	ErrVersionMismatch = errors.New("quotation version mismatch")
)

// Filter and sort params.
type ListFilter struct {
	Q        string
	Statuses []string
	DateFrom *string
	DateTo   *string
	MinTotal *string
	MaxTotal *string
	SortBy   string
	SortDir  string
	Limit    int
	Offset   int
}

// List rows with cost total + matching count.
func (r *Repo) List(ctx context.Context, f ListFilter) (ListResult, error) {
	sortBy := "q.created_at"
	switch f.SortBy {
	case "grand_total", "total":
		sortBy = "q.grand_total"
	case "quotation_no":
		sortBy = "q.quotation_no"
	case "version":
		sortBy = "q.version"
	}
	sortDir := "DESC"
	if strings.EqualFold(f.SortDir, "asc") {
		sortDir = "ASC"
	}

	args := []any{}
	addArg := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(len(args))
	}
	where := strings.Builder{}
	if f.Q != "" {
		p := addArg("%" + f.Q + "%")
		where.WriteString(" AND (q.quotation_no ILIKE " + p + " OR q.company_client_name ILIKE " + p + ")")
	}
	if len(f.Statuses) > 0 {
		p := addArg(f.Statuses)
		where.WriteString(" AND q.status = ANY(" + p + ")")
	}
	if f.DateFrom != nil {
		p := addArg(*f.DateFrom)
		where.WriteString(" AND q.created_at >= " + p + "::date")
	}
	if f.DateTo != nil {
		p := addArg(*f.DateTo)
		where.WriteString(" AND q.created_at < (" + p + "::date + INTERVAL '1 day')")
	}
	if f.MinTotal != nil {
		p := addArg(*f.MinTotal)
		where.WriteString(" AND q.grand_total >= " + p + "::numeric")
	}
	if f.MaxTotal != nil {
		p := addArg(*f.MaxTotal)
		where.WriteString(" AND q.grand_total <= " + p + "::numeric")
	}

	var out ListResult
	countSQL := r.store.Get("quotations.list_count_base") + where.String()
	if err := r.db.QueryRow(ctx, countSQL, args...).Scan(&out.Total); err != nil {
		return out, err
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
	dataSQL := r.store.Get("quotations.list_base") + where.String() +
		" ORDER BY " + sortBy + " " + sortDir +
		" LIMIT " + dataAdd(limit) +
		" OFFSET " + dataAdd(f.Offset)

	rows, err := r.db.Query(ctx, dataSQL, dataArgs...)
	if err != nil {
		return out, err
	}
	out.Rows, err = pgx.CollectRows(rows, pgx.RowToStructByName[ListRow])
	if out.Rows == nil {
		out.Rows = []ListRow{}
	}
	return out, err
}

// Counts grouped by status.
func (r *Repo) Stats(ctx context.Context) ([]StatusCount, error) {
	rows, err := r.db.Query(ctx, r.store.Get("quotations.stats"))
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[StatusCount])
}

// GetDetail returns header, items, history.
func (r *Repo) GetDetail(ctx context.Context, id int64) (QuotationDetail, error) {
	var d QuotationDetail

	rows, err := r.db.Query(ctx, r.store.Get("quotations.get_header"), id)
	if err != nil {
		return d, err
	}
	q, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[Quotation])
	if errors.Is(err, pgx.ErrNoRows) {
		return d, ErrNotFound
	}
	if err != nil {
		return d, err
	}
	d.Quotation = q

	itemRows, err := r.db.Query(ctx, r.store.Get("quotations.get_items"), id)
	if err != nil {
		return d, err
	}
	items, err := pgx.CollectRows(itemRows, pgx.RowToStructByName[QuotationItem])
	if err != nil {
		return d, err
	}
	d.Items = items

	histRows, err := r.db.Query(ctx, r.store.Get("quotations.get_history"), id)
	if err != nil {
		return d, err
	}
	hist, err := pgx.CollectRows(histRows, pgx.RowToStructByName[StatusHistoryEntry])
	if err != nil {
		return d, err
	}
	d.History = hist

	return d, nil
}

// Create calls fn_create_quotation atomically.
func (r *Repo) Create(ctx context.Context, req CreateRequest, userID int64) (int64, error) {
	itemsJSON, err := itemsToJSONB(req.Items)
	if err != nil {
		return 0, err
	}

	status := "draft"
	if req.Status != nil && *req.Status != "" {
		status = *req.Status
	}

	var id int64
	err = r.db.QueryRow(ctx, r.store.Get("quotations.fn_create"),
		req.CompanyClientID, req.ContactID, req.ClientRefNo, req.VesselName,
		req.PaymentTerms, req.ValidityDays, req.DiscountPct,
		req.ShippingAddress, req.ShippingDays, req.ShippingCost,
		itemsJSON, userID, req.Notes, status,
	).Scan(&id)
	return id, err
}

// Update calls fn_update_quotation_versioned. Draft only.
// ifMatch nil skips the version guard (legacy callers / tests).
// Returns new row_version. Maps P0010 -> ErrVersionMismatch, P0011 -> ErrNotFound.
func (r *Repo) Update(
	ctx context.Context, id int64, req UpdateRequest, userID int64, ifMatch *int32,
) (int32, error) {
	itemsJSON, err := itemsToJSONB(req.Items)
	if err != nil {
		return 0, err
	}

	if ifMatch == nil {
		var legacyID int64
		err = r.db.QueryRow(ctx, r.store.Get("quotations.fn_update"),
			id, req.ClientRefNo, req.VesselName, req.PaymentTerms, req.ValidityDays,
			req.DiscountPct, req.ShippingAddress, req.ShippingDays, req.ShippingCost,
			itemsJSON, userID, req.Notes,
		).Scan(&legacyID)
		if err != nil {
			return 0, err
		}
		var rv int32
		if err = r.db.QueryRow(ctx, r.store.Get("quotations.row_version"), id).Scan(&rv); err != nil {
			return 0, err
		}
		return rv, nil
	}

	var newVersion int32
	err = r.db.QueryRow(ctx, r.store.Get("quotations.fn_update_versioned"),
		id, *ifMatch, req.ClientRefNo, req.VesselName, req.PaymentTerms, req.ValidityDays,
		req.DiscountPct, req.ShippingAddress, req.ShippingDays, req.ShippingCost,
		itemsJSON, userID, req.Notes,
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
		return 0, err
	}
	return newVersion, nil
}

// ChangeStatus calls fn_change_quotation_status atomically.
func (r *Repo) ChangeStatus(ctx context.Context, id int64, status string, note *string, userID int64) error {
	_, err := r.db.Exec(ctx, r.store.Get("quotations.fn_change_status"),
		id, status, userID, note,
	)
	return err
}

// ListRevisions returns the full parent/child chain ordered by version.
// Empty slice when id is unknown.
func (r *Repo) ListRevisions(ctx context.Context, id int64) ([]RevisionRow, error) {
	rows, err := r.db.Query(ctx, r.store.Get("quotations.list_revisions"), id)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[RevisionRow])
}

