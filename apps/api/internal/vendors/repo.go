package vendors

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

func (r *Repo) List(ctx context.Context, limit, offset int) ([]Vendor, error) {
	rows, err := r.db.Query(ctx, r.store.Get("vendors.list"), limit, offset)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[Vendor])
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
		req.Name, req.Location, req.ContactInfo, userID,
	)
	if err != nil {
		return Vendor{}, err
	}
	return pgx.CollectOneRow(rows, pgx.RowToStructByName[Vendor])
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
