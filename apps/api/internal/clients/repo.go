package clients

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

// ErrNotFound is returned when a client/contact is not found.
var ErrNotFound = errors.New("not found")

// ─── Companies ────────────────────────────────────────────────

// List returns active clients, paginated.
func (r *Repo) List(ctx context.Context, limit, offset int) ([]Client, error) {
	const q = `
		SELECT id, number, name, npwp, address, email, country_code,
		       tku_id, is_active, created_at, updated_at
		FROM company_client
		WHERE is_active = TRUE
		ORDER BY name
		LIMIT $1 OFFSET $2`

	rows, err := r.pool.Query(ctx, q, limit, offset)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[Client])
}

// GetByID returns a single client. Returns ErrNotFound if not found.
func (r *Repo) GetByID(ctx context.Context, id int64) (Client, error) {
	const q = `
		SELECT id, number, name, npwp, address, email, country_code,
		       tku_id, is_active, created_at, updated_at
		FROM company_client
		WHERE id = $1`

	rows, err := r.pool.Query(ctx, q, id)
	if err != nil {
		return Client{}, err
	}
	c, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[Client])
	if errors.Is(err, pgx.ErrNoRows) {
		return Client{}, ErrNotFound
	}
	return c, err
}

// Create inserts a new client. Returns the created row with id populated.
func (r *Repo) Create(ctx context.Context, req CreateClientRequest, userID int64) (Client, error) {
	const q = `
		INSERT INTO company_client
			(number, name, npwp, address, email, country_code, tku_id, created_by, updated_by)
		VALUES
			($1, $2, $3, $4, $5, COALESCE(NULLIF($6, ''), 'IDN'), $7, $8, $8)
		RETURNING id, number, name, npwp, address, email, country_code,
		          tku_id, is_active, created_at, updated_at`

	rows, err := r.pool.Query(ctx, q,
		req.Number, req.Name, req.NPWP, req.Address, req.Email,
		req.CountryCode, req.TkuID, userID,
	)
	if err != nil {
		return Client{}, err
	}
	return pgx.CollectOneRow(rows, pgx.RowToStructByName[Client])
}

// Search calls fn_search_clients (fuzzy by company + contact + email).
func (r *Repo) Search(ctx context.Context, q string, minScore float32, limit int) ([]SearchResult, error) {
	const sql = `SELECT * FROM fn_search_clients($1, $2, $3)`

	rows, err := r.pool.Query(ctx, sql, q, minScore, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[SearchResult])
}

// ─── Contacts ─────────────────────────────────────────────────

// ListContacts returns active contacts of a company.
func (r *Repo) ListContacts(ctx context.Context, companyID int64) ([]Contact, error) {
	const q = `
		SELECT id, company_id, name, email, phone, title, country_code,
		       is_active, created_at, updated_at
		FROM company_contacts
		WHERE company_id = $1 AND is_active = TRUE
		ORDER BY name`

	rows, err := r.pool.Query(ctx, q, companyID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[Contact])
}

// CreateContact inserts a new contact under a company.
func (r *Repo) CreateContact(ctx context.Context, companyID int64, req CreateContactRequest, userID int64) (Contact, error) {
	const q = `
		INSERT INTO company_contacts
			(company_id, name, email, phone, title, country_code, created_by, updated_by)
		VALUES
			($1, $2, $3, $4, $5, COALESCE(NULLIF($6, ''), 'IDN'), $7, $7)
		RETURNING id, company_id, name, email, phone, title, country_code,
		          is_active, created_at, updated_at`

	rows, err := r.pool.Query(ctx, q,
		companyID, req.Name, req.Email, req.Phone, req.Title,
		req.CountryCode, userID,
	)
	if err != nil {
		return Contact{}, err
	}
	return pgx.CollectOneRow(rows, pgx.RowToStructByName[Contact])
}
