package items

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/listq"
)

type Repo struct {
	db    db.Executor
	store queries.Store
}

func NewRepo(exec db.Executor, store queries.Store) *Repo {
	return &Repo{db: exec, store: store}
}

// WithExec rebinds the repo to another executor, e.g. a pgx.Tx.
func (r *Repo) WithExec(exec db.Executor) *Repo {
	return &Repo{db: exec, store: r.store}
}

var ErrNotFound = errors.New("not found")

// sortable is the closed set of item sort keys.
var sortable = listq.Whitelist{
	Default: "name",
	Columns: map[string]listq.Column{
		"name":       {Expr: "name", Dir: listq.Asc},
		"createdAt":  {Expr: "created_at", Dir: listq.Desc},
		"created_at": {Expr: "created_at", Dir: listq.Desc},
		"impaCode":   {Expr: "impa_code", Dir: listq.Asc},
		"impa_code":  {Expr: "impa_code", Dir: listq.Asc},
	},
}

// tiebreak keeps paging stable when the sort key ties.
var tiebreak = listq.Column{Expr: "id", Dir: listq.Desc}

func (r *Repo) List(ctx context.Context, f ListFilter) (ListResult, error) {
	c := listq.New()
	if f.Q != "" {
		p := c.Arg("%" + f.Q + "%")
		c.And("(name ILIKE " + p + " OR impa_code ILIKE " + p + ")")
	}
	if f.IsActive != nil {
		p := c.Arg(*f.IsActive)
		c.And("is_active = " + p)
	}
	if f.UnitID != nil {
		p := c.Arg(*f.UnitID)
		c.And("default_unit_id = " + p)
	}

	var out ListResult
	countSQL, countArgs := c.Count(r.store.Get("items.list_count_base"))
	if err := r.db.QueryRow(ctx, countSQL, countArgs...).Scan(&out.Total); err != nil {
		return out, err
	}

	dataSQL, dataArgs := c.Data(
		r.store.Get("items.list_base"),
		listq.OrderBy(sortable, f.SortBy, f.SortDir, tiebreak),
		listq.Page(f.Limit, f.Offset),
	)

	rows, err := r.db.Query(ctx, dataSQL, dataArgs...)
	if err != nil {
		return out, err
	}
	out.Rows, err = pgx.CollectRows(rows, pgx.RowToStructByName[Item])
	if out.Rows == nil {
		out.Rows = []Item{}
	}
	return out, err
}

func (r *Repo) GetByID(ctx context.Context, id int64) (Item, error) {
	rows, err := r.db.Query(ctx, r.store.Get("items.get_by_id"), id)
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
	rows, err := r.db.Query(ctx, r.store.Get("items.create"),
		req.Name, req.IMPACode, req.DefaultUnitID, req.Description, req.IsActive, userID,
	)
	if err != nil {
		return Item{}, err
	}
	return pgx.CollectOneRow(rows, pgx.RowToStructByName[Item])
}

func (r *Repo) Update(ctx context.Context, id int64, req UpdateItemRequest, userID int64) (Item, error) {
	rows, err := r.db.Query(ctx, r.store.Get("items.update"),
		id, req.Name, req.IMPACode, req.DefaultUnitID, req.Description, req.IsActive, userID,
	)
	if err != nil {
		return Item{}, err
	}
	item, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[Item])
	if errors.Is(err, pgx.ErrNoRows) {
		return Item{}, ErrNotFound
	}
	return item, err
}

// UpdateImage writes the MinIO object key for the item image.
func (r *Repo) UpdateImage(ctx context.Context, id int64, objectKey string, userID int64) error {
	tag, err := r.db.Exec(ctx, r.store.Get("items.update_image"), id, objectKey, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Upsert vendor_products row.
func (r *Repo) AddVendor(ctx context.Context, itemID int64, req AddVendorToItemRequest, userID int64) (VendorForItem, error) {
	cost := "0"
	if req.CostPrice != nil && *req.CostPrice != "" {
		cost = *req.CostPrice
	}
	var productURL *string
	if req.ProductURL != nil && *req.ProductURL != "" {
		productURL = req.ProductURL
	}
	rows, err := r.db.Query(ctx, r.store.Get("items.add_vendor"),
		req.VendorID, itemID, req.VendorSKU, cost, productURL, userID,
	)
	if err != nil {
		return VendorForItem{}, err
	}
	return pgx.CollectOneRow(rows, pgx.RowToStructByName[VendorForItem])
}

func (r *Repo) Search(ctx context.Context, q string, minScore float32, limit int) ([]SearchResult, error) {
	rows, err := r.db.Query(ctx, r.store.Get("items.search"), q, minScore, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[SearchResult])
}

// ItemMeta is the real catalog identity for a merged search hit, used to set
// the true is_active flag and to backfill name/impa/unit for hits that came
// only from the vendor-offer or request-history layers.
type ItemMeta struct {
	Active        bool
	Name          string
	IMPACode      *string
	DefaultUnitID *int16
}

// ItemMetaByIDs maps item id to its catalog identity. Ids with no row are
// absent from the map (treated as inactive by the caller).
func (r *Repo) ItemMetaByIDs(ctx context.Context, ids []int64) (map[int64]ItemMeta, error) {
	out := map[int64]ItemMeta{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := r.db.Query(ctx, r.store.Get("items.active_flags_by_ids"), ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var m ItemMeta
		if err := rows.Scan(&id, &m.Active, &m.Name, &m.IMPACode, &m.DefaultUnitID); err != nil {
			return nil, err
		}
		out[id] = m
	}
	return out, rows.Err()
}

func (r *Repo) MatchRequest(ctx context.Context, reqText string, limit int) ([]MatchResult, error) {
	rows, err := r.db.Query(ctx, r.store.Get("items.match_request"), reqText, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[MatchResult])
}

// ListVendorsForItem joins vendor_products and vendors.
func (r *Repo) ListVendorsForItem(ctx context.Context, itemID int64) ([]VendorForItem, error) {
	rows, err := r.db.Query(ctx, r.store.Get("items.list_vendors_for_item"), itemID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[VendorForItem])
}

// FindByIMPA returns first active item matching IMPA code exactly.
func (r *Repo) FindByIMPA(ctx context.Context, impa string) (int64, error) {
	rows, err := r.db.Query(ctx, r.store.Get("items.find_by_impa"), impa)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	if !rows.Next() {
		return 0, ErrNotFound
	}
	var id int64
	if err := rows.Scan(&id); err != nil {
		return 0, err
	}
	return id, nil
}

// MatchWithVendorByID returns item enriched with cheapest active vendor.
func (r *Repo) MatchWithVendorByID(ctx context.Context, itemID int64) (MatchedItemWithVendor, error) {
	rows, err := r.db.Query(ctx, r.store.Get("items.match_with_vendor_by_id"), itemID)
	if err != nil {
		return MatchedItemWithVendor{}, err
	}
	out, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[MatchedItemWithVendor])
	if errors.Is(err, pgx.ErrNoRows) {
		return MatchedItemWithVendor{}, ErrNotFound
	}
	return out, err
}

// SuggestSellingPrices powers price-history view.
func (r *Repo) SuggestSellingPrices(ctx context.Context, itemID int64, limit int) ([]PriceHistory, error) {
	rows, err := r.db.Query(ctx, r.store.Get("items.suggest_selling_prices"), itemID, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[PriceHistory])
}

// SearchVendorOffers runs the VENDOR_OFFER tier query.
func (r *Repo) SearchVendorOffers(ctx context.Context, q string, limit int) ([]VendorOfferHit, error) {
	rows, err := r.db.Query(ctx, r.store.Get("items.search_vendor_offers"), q, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[VendorOfferHit])
}

// SearchRequestHistory runs the REQUEST_HISTORY tier query.
func (r *Repo) SearchRequestHistory(ctx context.Context, q string, limit int) ([]RequestHistoryHit, error) {
	rows, err := r.db.Query(ctx, r.store.Get("items.search_request_history"), q, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[RequestHistoryHit])
}
