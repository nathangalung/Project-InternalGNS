package quotations

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

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

var ErrNotFound = errors.New("not found")

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

// List rows with cost total.
func (r *Repo) List(ctx context.Context, f ListFilter) ([]ListRow, error) {
	// Whitelist sort fields against injection.
	sortBy := "q.created_at"
	switch f.SortBy {
	case "total":
		sortBy = "q.total"
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
	conds := strings.Builder{}
	conds.WriteString(r.store.Get("quotations.list_base"))

	addArg := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(len(args))
	}

	if f.Q != "" {
		p := addArg("%" + f.Q + "%")
		conds.WriteString(" AND (q.quotation_no ILIKE " + p + " OR q.company_client_name ILIKE " + p + ")")
	}
	if len(f.Statuses) > 0 {
		p := addArg(f.Statuses)
		conds.WriteString(" AND q.status = ANY(" + p + ")")
	}
	if f.DateFrom != nil {
		p := addArg(*f.DateFrom)
		conds.WriteString(" AND q.created_at >= " + p + "::date")
	}
	if f.DateTo != nil {
		p := addArg(*f.DateTo)
		conds.WriteString(" AND q.created_at < (" + p + "::date + INTERVAL '1 day')")
	}
	if f.MinTotal != nil {
		p := addArg(*f.MinTotal)
		conds.WriteString(" AND q.total >= " + p + "::numeric")
	}
	if f.MaxTotal != nil {
		p := addArg(*f.MaxTotal)
		conds.WriteString(" AND q.total <= " + p + "::numeric")
	}

	conds.WriteString(" ORDER BY " + sortBy + " " + sortDir)

	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	conds.WriteString(" LIMIT " + addArg(limit))
	conds.WriteString(" OFFSET " + addArg(f.Offset))

	rows, err := r.db.Query(ctx, conds.String(), args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[ListRow])
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

// Update calls fn_update_quotation. Draft only.
func (r *Repo) Update(ctx context.Context, id int64, req UpdateRequest, userID int64) (int64, error) {
	itemsJSON, err := itemsToJSONB(req.Items)
	if err != nil {
		return 0, err
	}

	var newID int64
	err = r.db.QueryRow(ctx, r.store.Get("quotations.fn_update"),
		id, req.ClientRefNo, req.VesselName, req.PaymentTerms, req.ValidityDays,
		req.DiscountPct, req.ShippingAddress, req.ShippingDays, req.ShippingCost,
		itemsJSON, userID, req.Notes,
	).Scan(&newID)
	return newID, err
}

// ChangeStatus calls fn_change_quotation_status atomically.
func (r *Repo) ChangeStatus(ctx context.Context, id int64, status string, note *string, userID int64) error {
	_, err := r.db.Exec(ctx, r.store.Get("quotations.fn_change_status"),
		id, status, userID, note,
	)
	return err
}

