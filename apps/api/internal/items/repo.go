package items

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

// ─── Items master ─────────────────────────────────────────────

func (r *Repo) List(ctx context.Context, limit, offset int) ([]Item, error) {
	const q = `
		SELECT id, name, impa_code, default_unit_id, description,
		       is_active, created_at, updated_at
		FROM items
		WHERE is_active = TRUE
		ORDER BY name
		LIMIT $1 OFFSET $2`

	rows, err := r.pool.Query(ctx, q, limit, offset)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[Item])
}

func (r *Repo) GetByID(ctx context.Context, id int64) (Item, error) {
	const q = `
		SELECT id, name, impa_code, default_unit_id, description,
		       is_active, created_at, updated_at
		FROM items
		WHERE id = $1`

	rows, err := r.pool.Query(ctx, q, id)
	if err != nil {
		return Item{}, err
	}
	c, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[Item])
	if errors.Is(err, pgx.ErrNoRows) {
		return Item{}, ErrNotFound
	}
	return c, err
}

func (r *Repo) Create(ctx context.Context, req CreateItemRequest, userID int64) (Item, error) {
	const q = `
		INSERT INTO items (name, impa_code, default_unit_id, description, created_by, updated_by)
		VALUES ($1, $2, $3, $4, $5, $5)
		RETURNING id, name, impa_code, default_unit_id, description,
		          is_active, created_at, updated_at`

	rows, err := r.pool.Query(ctx, q, req.Name, req.IMPACode, req.DefaultUnitID, req.Description, userID)
	if err != nil {
		return Item{}, err
	}
	return pgx.CollectOneRow(rows, pgx.RowToStructByName[Item])
}

// ─── Search & match (DB function calls) ───────────────────────

func (r *Repo) Search(ctx context.Context, q string, minScore float32, limit int) ([]SearchResult, error) {
	const sql = `SELECT * FROM fn_search_items($1, $2, $3)`

	rows, err := r.pool.Query(ctx, sql, q, minScore, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[SearchResult])
}

func (r *Repo) MatchRequest(ctx context.Context, reqText string, limit int) ([]MatchResult, error) {
	const sql = `SELECT * FROM fn_match_request($1, $2)`

	rows, err := r.pool.Query(ctx, sql, reqText, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[MatchResult])
}

// ListVendorsForItem returns all vendor_products for an item, joined with vendor.
func (r *Repo) ListVendorsForItem(ctx context.Context, itemID int64) ([]VendorForItem, error) {
	const sql = `
		SELECT
			vp.id              AS vendor_product_id,
			v.id               AS vendor_id,
			v.name             AS vendor_name,
			vp.vendor_sku,
			vp.cost_price::text,
			vp.last_quoted_at::text
		FROM vendor_products vp
		JOIN vendors v ON v.id = vp.vendor_id
		WHERE vp.item_id = $1 AND v.is_active = TRUE
		ORDER BY vp.cost_price ASC NULLS LAST`

	rows, err := r.pool.Query(ctx, sql, itemID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[VendorForItem])
}

// SuggestSellingPrices calls fn_suggest_selling_prices for price-history view.
func (r *Repo) SuggestSellingPrices(ctx context.Context, itemID int64, limit int) ([]PriceHistory, error) {
	const sql = `
		SELECT
			quotation_no,
			quotation_date::text,
			client_name,
			qty::text,
			cost_price::text,
			selling_price::text,
			profit_pct::text
		FROM fn_suggest_selling_prices($1, $2)`

	rows, err := r.pool.Query(ctx, sql, itemID, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[PriceHistory])
}
