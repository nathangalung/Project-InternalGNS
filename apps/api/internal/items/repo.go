package items

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

func (r *Repo) List(ctx context.Context, f ListFilter) (ListResult, error) {
	args := []any{}
	addArg := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(len(args))
	}
	where := strings.Builder{}
	if f.Q != "" {
		p := addArg("%" + f.Q + "%")
		where.WriteString(" AND (name ILIKE " + p + " OR impa_code ILIKE " + p + ")")
	}
	if f.IsActive != nil {
		p := addArg(*f.IsActive)
		where.WriteString(" AND is_active = " + p)
	}
	if f.UnitID != nil {
		p := addArg(*f.UnitID)
		where.WriteString(" AND default_unit_id = " + p)
	}

	var out ListResult
	countSQL := r.store.Get("items.list_count_base") + where.String()
	if err := r.db.QueryRow(ctx, countSQL, args...).Scan(&out.Total); err != nil {
		return out, err
	}

	sortBy := "name"
	switch f.SortBy {
	case "createdAt", "created_at":
		sortBy = "created_at"
	case "impaCode", "impa_code":
		sortBy = "impa_code"
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
	dataSQL := r.store.Get("items.list_base") +
		where.String() +
		" ORDER BY " + sortBy + " " + sortDir +
		" LIMIT " + dataAdd(limit) + " OFFSET " + dataAdd(f.Offset)

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
		req.Name, req.IMPACode, req.DefaultUnitID, req.Description, userID,
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
