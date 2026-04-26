package vendors

import (
	"context"
	"errors"

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

func (r *Repo) List(ctx context.Context, limit, offset int) ([]Vendor, error) {
	const q = `
		SELECT id, name, location, contact_info, is_active, created_at, updated_at
		FROM vendors
		WHERE is_active = TRUE
		ORDER BY name
		LIMIT $1 OFFSET $2`

	rows, err := r.pool.Query(ctx, q, limit, offset)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[Vendor])
}

func (r *Repo) GetByID(ctx context.Context, id int64) (Vendor, error) {
	const q = `
		SELECT id, name, location, contact_info, is_active, created_at, updated_at
		FROM vendors
		WHERE id = $1`

	rows, err := r.pool.Query(ctx, q, id)
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
	const q = `
		INSERT INTO vendors (name, location, contact_info, created_by, updated_by)
		VALUES ($1, $2, $3, $4, $4)
		RETURNING id, name, location, contact_info, is_active, created_at, updated_at`

	rows, err := r.pool.Query(ctx, q, req.Name, req.Location, req.ContactInfo, userID)
	if err != nil {
		return Vendor{}, err
	}
	return pgx.CollectOneRow(rows, pgx.RowToStructByName[Vendor])
}

// Search calls fn_search_vendors.
func (r *Repo) Search(ctx context.Context, q string, minScore float32, limit int) ([]SearchResult, error) {
	const sql = `SELECT * FROM fn_search_vendors($1, $2, $3)`

	rows, err := r.pool.Query(ctx, sql, q, minScore, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[SearchResult])
}

// ListItems calls fn_search_items_by_vendor.
func (r *Repo) ListItems(ctx context.Context, vendorID int64, limit int) ([]ItemByVendor, error) {
	const sql = `
		SELECT
			item_id, item_name, impa_code, vendor_sku,
			cost_price::text,
			last_quoted_at::text
		FROM fn_search_items_by_vendor($1, $2)`

	rows, err := r.pool.Query(ctx, sql, vendorID, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[ItemByVendor])
}
