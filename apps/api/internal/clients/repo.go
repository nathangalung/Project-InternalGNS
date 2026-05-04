package clients

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

// Missing client or contact.
var ErrNotFound = errors.New("not found")

// List returns active clients, paginated.
func (r *Repo) List(ctx context.Context, limit, offset int) ([]Client, error) {
	rows, err := r.db.Query(ctx, r.store.Get("clients.list"), limit, offset)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[Client])
}

// GetByID returns one client.
func (r *Repo) GetByID(ctx context.Context, id int64) (Client, error) {
	rows, err := r.db.Query(ctx, r.store.Get("clients.get_by_id"), id)
	if err != nil {
		return Client{}, err
	}
	c, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[Client])
	if errors.Is(err, pgx.ErrNoRows) {
		return Client{}, ErrNotFound
	}
	return c, err
}

// Create inserts a new client.
func (r *Repo) Create(ctx context.Context, req CreateClientRequest, userID int64) (Client, error) {
	rows, err := r.db.Query(ctx, r.store.Get("clients.create"),
		req.Number, req.Name, req.NPWP, req.Address, req.Email,
		req.CountryCode, req.TkuID, userID,
	)
	if err != nil {
		return Client{}, err
	}
	return pgx.CollectOneRow(rows, pgx.RowToStructByName[Client])
}

// Update edits a client row.
func (r *Repo) Update(ctx context.Context, id int64, req UpdateClientRequest, userID int64) (Client, error) {
	rows, err := r.db.Query(ctx, r.store.Get("clients.update"),
		id, req.Name, req.NPWP, req.Address, req.Email,
		req.CountryCode, req.TkuID, req.IsActive, userID,
	)
	if err != nil {
		return Client{}, err
	}
	c, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[Client])
	if errors.Is(err, pgx.ErrNoRows) {
		return Client{}, ErrNotFound
	}
	return c, err
}

// Search calls fn_search_clients fuzzy match.
func (r *Repo) Search(ctx context.Context, q string, minScore float32, limit int) ([]SearchResult, error) {
	rows, err := r.db.Query(ctx, r.store.Get("clients.search"), q, minScore, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[SearchResult])
}

// ListContacts returns company contacts.
func (r *Repo) ListContacts(ctx context.Context, companyID int64) ([]Contact, error) {
	rows, err := r.db.Query(ctx, r.store.Get("clients.list_contacts"), companyID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[Contact])
}

// Summary aggregates KPIs.
func (r *Repo) Summary(ctx context.Context) (Summary, error) {
	rows, err := r.db.Query(ctx, r.store.Get("clients.summary"))
	if err != nil {
		return Summary{}, err
	}
	return pgx.CollectOneRow(rows, pgx.RowToStructByName[Summary])
}

// CreateContact inserts new contact.
func (r *Repo) CreateContact(ctx context.Context, companyID int64, req CreateContactRequest, userID int64) (Contact, error) {
	rows, err := r.db.Query(ctx, r.store.Get("clients.create_contact"),
		companyID, req.Name, req.Email, req.Phone, req.Title,
		req.CountryCode, userID,
	)
	if err != nil {
		return Contact{}, err
	}
	return pgx.CollectOneRow(rows, pgx.RowToStructByName[Contact])
}
