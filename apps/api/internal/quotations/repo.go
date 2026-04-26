package quotations

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repo struct {
	pool *pgxpool.Pool
}

func NewRepo(pool *pgxpool.Pool) *Repo {
	return &Repo{pool: pool}
}

var ErrNotFound = errors.New("not found")

// ListFilter holds filter & sort params untuk GET /quotations.
type ListFilter struct {
	Q          string   // search by quotation_no or company name
	Statuses   []string // filter by status (multi)
	DateFrom   *string  // YYYY-MM-DD
	DateTo     *string
	MinTotal   *string  // numeric as string
	MaxTotal   *string
	SortBy     string   // 'created_at' | 'total' | 'quotation_no' | 'version'
	SortDir    string   // 'asc' | 'desc'
	Limit      int
	Offset     int
}

// List returns rows + total_harga_beli computed via subquery.
func (r *Repo) List(ctx context.Context, f ListFilter) ([]ListRow, error) {
	// Whitelist sort fields untuk hindari SQL injection
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

	const baseQ = `
		SELECT
			q.id,
			q.quotation_no,
			q.version,
			q.company_client_name AS company_name,
			q.status,
			q.total::text,
			COALESCE((
				SELECT SUM(qi.qty * qi.cost_price)::text
				FROM quotation_items qi
				WHERE qi.quotation_id = q.id AND qi.item_type = 'product'
			), '0') AS total_harga_beli,
			q.created_at
		FROM quotations q
		WHERE 1=1`

	args := []any{}
	conds := strings.Builder{}
	conds.WriteString(baseQ)

	addArg := func(v any) string {
		args = append(args, v)
		return "$" + itoa(len(args))
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

	rows, err := r.pool.Query(ctx, conds.String(), args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[ListRow])
}

// Stats returns count GROUP BY status untuk summary cards.
func (r *Repo) Stats(ctx context.Context) ([]StatusCount, error) {
	const q = `
		SELECT status, COUNT(*) AS count
		FROM quotations
		GROUP BY status
		ORDER BY status`

	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[StatusCount])
}

// GetDetail returns header + items + history.
func (r *Repo) GetDetail(ctx context.Context, id int64) (QuotationDetail, error) {
	var d QuotationDetail

	const headerQ = `
		SELECT id, quotation_no, version, company_client_id, company_client_name,
		       contact_id, contact_name, client_ref_no, vessel_name, status,
		       payment_terms, validity_days,
		       discount_pct::text, total_produk::text, total::text, total_discount::text,
		       notes, created_at, updated_at
		FROM quotations
		WHERE id = $1`

	rows, err := r.pool.Query(ctx, headerQ, id)
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

	const itemsQ = `
		SELECT id, quotation_id, line_number, item_type,
		       requested_item_id, requested_impa, requested_name,
		       offered_item_id, vendor_product_id,
		       qty::text, unit_id,
		       selling_price::text, cost_price::text,
		       discount_pct::text, total_selling::text,
		       discount_amount::text, subtotal::text,
		       is_available, ship_destination
		FROM quotation_items
		WHERE quotation_id = $1
		ORDER BY line_number`

	itemRows, err := r.pool.Query(ctx, itemsQ, id)
	if err != nil {
		return d, err
	}
	items, err := pgx.CollectRows(itemRows, pgx.RowToStructByName[QuotationItem])
	if err != nil {
		return d, err
	}
	d.Items = items

	const histQ = `
		SELECT id, from_status, to_status, note, changed_by, changed_at
		FROM quotation_status_history
		WHERE quotation_id = $1
		ORDER BY changed_at`

	histRows, err := r.pool.Query(ctx, histQ, id)
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

	const sql = `
		SELECT fn_create_quotation(
			$1, $2, $3, $4, $5, $6, $7::numeric(5,2),
			$8, $9, $10::numeric(15,2),
			$11::jsonb, $12, $13, $14
		)`

	var id int64
	err = r.pool.QueryRow(ctx, sql,
		req.CompanyClientID, req.ContactID, req.ClientRefNo, req.VesselName,
		req.PaymentTerms, req.ValidityDays, req.DiscountPct,
		req.ShippingAddress, req.ShippingDays, req.ShippingCost,
		itemsJSON, userID, req.Notes, status,
	).Scan(&id)
	return id, err
}

// Update calls fn_update_quotation atomically (DRAFT only).
func (r *Repo) Update(ctx context.Context, id int64, req UpdateRequest, userID int64) (int64, error) {
	itemsJSON, err := itemsToJSONB(req.Items)
	if err != nil {
		return 0, err
	}

	const sql = `
		SELECT fn_update_quotation(
			$1, $2, $3, $4, $5, $6::numeric(5,2),
			$7, $8, $9::numeric(15,2),
			$10::jsonb, $11, $12
		)`

	var newID int64
	err = r.pool.QueryRow(ctx, sql,
		id, req.ClientRefNo, req.VesselName, req.PaymentTerms, req.ValidityDays,
		req.DiscountPct, req.ShippingAddress, req.ShippingDays, req.ShippingCost,
		itemsJSON, userID, req.Notes,
	).Scan(&newID)
	return newID, err
}

// ChangeStatus calls fn_change_quotation_status atomically.
func (r *Repo) ChangeStatus(ctx context.Context, id int64, status string, note *string, userID int64) error {
	const sql = `SELECT fn_change_quotation_status($1, $2, $3, $4)`
	_, err := r.pool.Exec(ctx, sql, id, status, userID, note)
	return err
}

// ─── Helpers ──────────────────────────────────────────────────

// itoa is local to avoid stdlib import for a simple use.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	digits := []byte{}
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	return string(digits)
}
