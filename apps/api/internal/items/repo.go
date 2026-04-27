package items

import (
	"context"
	"errors"

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

func (r *Repo) List(ctx context.Context, limit, offset int) ([]Item, error) {
	rows, err := r.db.Query(ctx, r.store.Get("items.list"), limit, offset)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[Item])
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

// SuggestSellingPrices powers price-history view.
func (r *Repo) SuggestSellingPrices(ctx context.Context, itemID int64, limit int) ([]PriceHistory, error) {
	rows, err := r.db.Query(ctx, r.store.Get("items.suggest_selling_prices"), itemID, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[PriceHistory])
}
