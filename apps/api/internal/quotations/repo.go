package quotations

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	dbpkg "github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/listq"
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
	ErrNotFound          = errors.New("not found")
	ErrVersionMismatch   = errors.New("quotation version mismatch")
	ErrUnpricedProducts  = errors.New("product lines without a selling price")
	ErrContactNotAllowed = errors.New("contact not allowed")
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

// sortable is the closed set of quotation sort keys.
var sortable = listq.Whitelist{
	Default: "created_at",
	Columns: map[string]listq.Column{
		"createdAt":    {Expr: "q.created_at", Dir: listq.Desc},
		"created_at":   {Expr: "q.created_at", Dir: listq.Desc},
		"grandTotal":   {Expr: "q.grand_total", Dir: listq.Desc},
		"grand_total":  {Expr: "q.grand_total", Dir: listq.Desc},
		"total":        {Expr: "q.grand_total", Dir: listq.Desc},
		"quotationNo":  {Expr: "q.quotation_no", Dir: listq.Desc},
		"quotation_no": {Expr: "q.quotation_no", Dir: listq.Desc},
		"version":      {Expr: "q.version", Dir: listq.Desc},
	},
}

// tiebreak keeps paging stable when the sort key ties.
var tiebreak = listq.Column{Expr: "q.id", Dir: listq.Desc}

// List rows with cost total + matching count.
func (r *Repo) List(ctx context.Context, f ListFilter) (ListResult, error) {
	c := listq.New()
	if f.Q != "" {
		p := c.Arg("%" + f.Q + "%")
		c.And("(q.quotation_no ILIKE " + p + " OR q.company_client_name ILIKE " + p + ")")
	}
	if len(f.Statuses) > 0 {
		p := c.Arg(f.Statuses)
		c.And("q.status = ANY(" + p + ")")
	}
	if f.DateFrom != nil {
		p := c.Arg(*f.DateFrom)
		c.And("q.created_at >= " + p + "::date")
	}
	if f.DateTo != nil {
		p := c.Arg(*f.DateTo)
		c.And("q.created_at < (" + p + "::date + INTERVAL '1 day')")
	}
	if f.MinTotal != nil {
		p := c.Arg(*f.MinTotal)
		c.And("q.grand_total >= " + p + "::numeric")
	}
	if f.MaxTotal != nil {
		p := c.Arg(*f.MaxTotal)
		c.And("q.grand_total <= " + p + "::numeric")
	}

	var out ListResult
	countSQL, countArgs := c.Count(r.store.Get("quotations.list_count_base"))
	if err := r.db.QueryRow(ctx, countSQL, countArgs...).Scan(&out.Total); err != nil {
		return out, err
	}

	dataSQL, dataArgs := c.Data(
		r.store.Get("quotations.list_base"),
		listq.OrderBy(sortable, f.SortBy, f.SortDir, tiebreak),
		listq.Page(f.Limit, f.Offset),
	)

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

// ChangeStatus calls fn_change_quotation_status atomically. Finalizing
// (sent/accepted) requires every product priced; that guard runs inside the
// function under its row lock and surfaces as SQLSTATE P0100.
func (r *Repo) ChangeStatus(ctx context.Context, id int64, status string, note *string, userID int64) error {
	_, err := r.db.Exec(ctx, r.store.Get("quotations.fn_change_status"),
		id, status, userID, note,
	)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "P0100" {
			return ErrUnpricedProducts
		}
	}
	return err
}

// UpdateContact updates contact snapshot.
func (r *Repo) UpdateContact(ctx context.Context, id, contactID, userID int64) error {
	var result string
	err := r.db.QueryRow(ctx, r.store.Get("quotations.update_contact"), id, contactID, userID).Scan(&result)
	if err != nil {
		return err
	}
	switch result {
	case "not_found":
		return ErrNotFound
	case "contact_invalid":
		return ErrContactNotAllowed
	}
	return nil
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
