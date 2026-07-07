package vendors

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
)

type Repo struct {
	db    db.Executor
	store queries.Store
}

func NewRepo(exec db.Executor, store queries.Store) *Repo {
	return &Repo{db: exec, store: store}
}

var ErrNotFound = errors.New("not found")

// List returns vendors with filter/sort and total count.
func (r *Repo) List(ctx context.Context, f ListFilter) (ListResult, error) {
	args := []any{}
	addArg := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(len(args))
	}
	where := strings.Builder{}
	if f.Q != "" {
		p := addArg("%" + f.Q + "%")
		where.WriteString(" AND (v.name ILIKE " + p + " OR v.location ILIKE " + p + ")")
	}
	if f.IsActive != nil {
		p := addArg(*f.IsActive)
		where.WriteString(" AND v.is_active = " + p)
	}
	if f.CountryName != "" {
		p := addArg("%" + f.CountryName + "%")
		where.WriteString(" AND v.location ILIKE " + p)
	}
	if f.MinTotal != nil {
		p := addArg(*f.MinTotal)
		where.WriteString(" AND COALESCE((SELECT SUM(qi.total_cost) FROM quotation_items qi" +
			" JOIN vendor_products vp ON vp.id = qi.vendor_product_id" +
			" JOIN quotations q ON q.id = qi.quotation_id" +
			" WHERE vp.vendor_id = v.id AND q.status = 'accepted'), 0) >= " + p + "::numeric")
	}

	var out ListResult
	countSQL := r.store.Get("vendors.list_count_base") + where.String()
	if err := r.db.QueryRow(ctx, countSQL, args...).Scan(&out.Total); err != nil {
		return out, err
	}

	sortBy := "v.name"
	switch f.SortBy {
	case "createdAt", "created_at":
		sortBy = "v.created_at"
	case "totalPurchase", "total_purchase":
		sortBy = "COALESCE((SELECT SUM(qi.total_cost) FROM quotation_items qi" +
			" JOIN vendor_products vp ON vp.id = qi.vendor_product_id" +
			" JOIN quotations q ON q.id = qi.quotation_id" +
			" WHERE vp.vendor_id = v.id AND q.status = 'accepted'), 0)"
	case "productCount", "product_count":
		sortBy = "(SELECT COUNT(*) FROM vendor_products vp WHERE vp.vendor_id = v.id AND vp.is_active = TRUE)"
	}
	sortDir := "ASC"
	if strings.EqualFold(f.SortDir, "desc") {
		sortDir = "DESC"
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
	dataSQL := r.store.Get("vendors.list_base") +
		where.String() +
		" ORDER BY " + sortBy + " " + sortDir +
		" LIMIT " + dataAdd(limit) + " OFFSET " + dataAdd(f.Offset)

	rows, err := r.db.Query(ctx, dataSQL, dataArgs...)
	if err != nil {
		return out, err
	}
	out.Rows, err = pgx.CollectRows(rows, pgx.RowToStructByName[Vendor])
	if out.Rows == nil {
		out.Rows = []Vendor{}
	}
	return out, err
}

func (r *Repo) GetByID(ctx context.Context, id int64) (Vendor, error) {
	rows, err := r.db.Query(ctx, r.store.Get("vendors.get_by_id"), id)
	if err != nil {
		return Vendor{}, err
	}
	v, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[Vendor])
	if errors.Is(err, pgx.ErrNoRows) {
		return Vendor{}, ErrNotFound
	}
	return v, err
}

func (r *Repo) Create(ctx context.Context, req CreateVendorRequest, userID int64) (Vendor, error) {
	rows, err := r.db.Query(ctx, r.store.Get("vendors.create"),
		req.Name, req.Location, req.ContactInfo, req.IsActive, userID,
	)
	if err != nil {
		return Vendor{}, err
	}
	return pgx.CollectOneRow(rows, pgx.RowToStructByName[Vendor])
}

// Update edits a vendor row.
func (r *Repo) Update(ctx context.Context, id int64, req UpdateVendorRequest, userID int64) (Vendor, error) {
	rows, err := r.db.Query(ctx, r.store.Get("vendors.update"),
		id, req.Name, req.Location, req.ContactInfo, req.IsActive, userID,
	)
	if err != nil {
		return Vendor{}, err
	}
	v, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[Vendor])
	if errors.Is(err, pgx.ErrNoRows) {
		return Vendor{}, ErrNotFound
	}
	return v, err
}

// UpdateLogo writes the MinIO object key for the vendor logo.
func (r *Repo) UpdateLogo(ctx context.Context, id int64, objectKey string, userID int64) error {
	tag, err := r.db.Exec(ctx, r.store.Get("vendors.update_logo"), id, objectKey, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Search calls fn_search_vendors.
func (r *Repo) Search(ctx context.Context, q string, minScore float32, limit int) ([]SearchResult, error) {
	rows, err := r.db.Query(ctx, r.store.Get("vendors.search"), q, minScore, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[SearchResult])
}

// ListItems calls fn_search_items_by_vendor.
func (r *Repo) ListItems(ctx context.Context, vendorID int64, limit int) ([]ItemByVendor, error) {
	rows, err := r.db.Query(ctx, r.store.Get("vendors.list_items"), vendorID, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[ItemByVendor])
}
