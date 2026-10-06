package items

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

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

// WithExec rebinds the executor.
// Pass a pgx.Tx to run inside a transaction.
func (r *Repo) WithExec(exec db.Executor) *Repo {
	return &Repo{db: exec, store: r.store}
}

var ErrNotFound = errors.New("not found")

// ErrIMPATaken marks a duplicate code.
// Another active item already owns the IMPA code.
var ErrIMPATaken = errors.New("items: impa code taken")

// Vendor link failures.
var (
	ErrVendorNotFound = errors.New("items: vendor not found")
	ErrVendorInactive = errors.New("items: vendor inactive")
)

// sortable lists item sort keys.
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

// tiebreak keeps paging stable.
var tiebreak = listq.Column{Expr: "id", Dir: listq.Desc}

func (r *Repo) List(ctx context.Context, f ListFilter) (ListResult, error) {
	c := listq.New()
	if f.Q != "" {
		p := c.Arg(listq.Contains(f.Q))
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
		return Item{}, impaErr(err)
	}
	item, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[Item])
	return item, impaErr(err)
}

func (r *Repo) Update(ctx context.Context, id int64, req UpdateItemRequest, userID int64) (Item, error) {
	rows, err := r.db.Query(ctx, r.store.Get("items.update"),
		id, req.Name, req.IMPACode, req.DefaultUnitID, req.Description, req.IsActive, userID,
	)
	if err != nil {
		return Item{}, impaErr(err)
	}
	item, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[Item])
	if errors.Is(err, pgx.ErrNoRows) {
		return Item{}, ErrNotFound
	}
	return item, impaErr(err)
}

// impaErr marks taken codes.
// The database error stays wrapped, so a caller without a field to show it
// on still renders the generic conflict.
func impaErr(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.ConstraintName == "uq_items_impa_code_active" {
		return fmt.Errorf("%w: %w", ErrIMPATaken, err)
	}
	return err
}

// Images lists the gallery.
// An unknown item has no photos; the handler checks it exists first.
func (r *Repo) Images(ctx context.Context, id int64) ([]ItemImage, error) {
	rows, err := r.db.Query(ctx, r.store.Get("items.images"), id)
	if err != nil {
		return nil, fmt.Errorf("item images: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[ItemImage])
}

// AddImage appends a gallery photo.
// The first photo becomes the cover; past MaxItemImages it is refused.
func (r *Repo) AddImage(ctx context.Context, id int64, objectKey string, userID int64) (int64, error) {
	var imageID int64
	err := r.db.QueryRow(ctx, r.store.Get("items.image_add"), id, objectKey, userID).Scan(&imageID)
	return imageID, err
}

// DeleteImage removes one photo.
// A removed cover passes to the oldest photo left.
func (r *Repo) DeleteImage(ctx context.Context, id, imageID, userID int64) error {
	_, err := r.db.Exec(ctx, r.store.Get("items.image_delete"), id, imageID, userID)
	return err
}

// SetCover makes a photo the cover.
func (r *Repo) SetCover(ctx context.Context, id, imageID, userID int64) error {
	_, err := r.db.Exec(ctx, r.store.Get("items.image_set_cover"), id, imageID, userID)
	return err
}

// Recommend picks line defaults.
// The rules live in fn_recommend_lines; a nil client takes no client's
// history into account.
func (r *Repo) Recommend(ctx context.Context, clientID *int64, itemIDs []int64) ([]Recommendation, error) {
	if len(itemIDs) == 0 {
		return []Recommendation{}, nil
	}
	rows, err := r.db.Query(ctx, r.store.Get("items.recommend"), clientID, itemIDs)
	if err != nil {
		return nil, fmt.Errorf("recommend lines: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[Recommendation])
}

// Upsert vendor_products row.
func (r *Repo) AddVendor(ctx context.Context, itemID int64, req AddVendorToItemRequest, userID int64) (VendorForItem, error) {
	cost := "0"
	// An unsent price keeps the stored one; a blank one stores zero
	priced := req.CostPrice != nil
	if priced && strings.TrimSpace(*req.CostPrice) != "" {
		cost = strings.TrimSpace(*req.CostPrice)
	}
	rows, err := r.db.Query(ctx, r.store.Get("items.add_vendor"),
		req.VendorID, itemID, req.VendorSKU.Value, cost, req.ProductURL.Value, userID,
		req.VendorSKU.Set, req.ProductURL.Set, priced,
	)
	if err != nil {
		return VendorForItem{}, err
	}
	link, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[VendorForItem])
	if errors.Is(err, pgx.ErrNoRows) {
		return VendorForItem{}, r.vendorLinkErr(ctx, req.VendorID)
	}
	return link, err
}

// vendorLinkErr explains a refused link.
func (r *Repo) vendorLinkErr(ctx context.Context, vendorID int64) error {
	var active bool
	err := r.db.QueryRow(ctx, r.store.Get("items.vendor_active"), vendorID).Scan(&active)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return ErrVendorNotFound
	case err != nil:
		return fmt.Errorf("load vendor %d: %w", vendorID, err)
	}
	// Inactive, or reactivated since the insert refused it.
	return ErrVendorInactive
}

// SearchCatalog runs the name layer.
//
// A nil isActive keeps active and inactive items alike.
func (r *Repo) SearchCatalog(ctx context.Context, q string, minScore float32, limit int, isActive *bool) ([]SearchResult, error) {
	rows, err := r.db.Query(ctx, r.store.Get("items.search_catalog"), q, minScore, limit, isActive)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[SearchResult])
}

// ItemMeta is catalog identity.
// It supplies the true is_active flag and backfills name/impa/unit for hits
// that came only from the vendor-offer or request-history layers.
type ItemMeta struct {
	Active         bool
	Name           string
	IMPACode       *string
	DefaultUnitID  *int16
	ImageObjectKey *string
}

// ItemMetaByIDs maps ids to identity.
// Ids with no row are absent from the map (treated as inactive by the
// caller).
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
		if err := rows.Scan(&id, &m.Active, &m.Name, &m.IMPACode, &m.DefaultUnitID, &m.ImageObjectKey); err != nil {
			return nil, err
		}
		out[id] = m
	}
	return out, rows.Err()
}

// ListVendorsForItem joins vendor_products and vendors.
func (r *Repo) ListVendorsForItem(ctx context.Context, itemID int64) ([]VendorForItem, error) {
	rows, err := r.db.Query(ctx, r.store.Get("items.list_vendors_for_item"), itemID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[VendorForItem])
}

// FindByIMPA finds exact active matches.
// The first active item with that IMPA code wins.
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

// MatchWithVendorByID adds the cheapest vendor.
// Only active vendors are considered.
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

// SearchVendorOffers queries VENDOR_OFFER tier.
func (r *Repo) SearchVendorOffers(ctx context.Context, q string, limit int, isActive *bool) ([]VendorOfferHit, error) {
	rows, err := r.db.Query(ctx, r.store.Get("items.search_vendor_offers"), q, limit, isActive)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[VendorOfferHit])
}

// SearchRequestHistory queries REQUEST_HISTORY tier.
func (r *Repo) SearchRequestHistory(ctx context.Context, q string, limit int, isActive *bool) ([]RequestHistoryHit, error) {
	rows, err := r.db.Query(ctx, r.store.Get("items.search_request_history"), q, limit, isActive)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[RequestHistoryHit])
}

// RecentQuotations lists the newest quotations.
// Only quotations that reached the client count (every status but draft
// and cancelled), newest first; these are the lines offered the product.
func (r *Repo) RecentQuotations(ctx context.Context, id int64) ([]ItemQuotation, error) {
	rows, err := r.db.Query(ctx, r.store.Get("items.recent_quotations"), id, RecentQuotationCount)
	if err != nil {
		return nil, fmt.Errorf("recent quotations: %w", err)
	}
	out, err := pgx.CollectRows(rows, pgx.RowToStructByName[ItemQuotation])
	if err != nil {
		return nil, fmt.Errorf("recent quotations: %w", err)
	}
	// Always a list, so the web never reads null.
	return append([]ItemQuotation{}, out...), nil
}
