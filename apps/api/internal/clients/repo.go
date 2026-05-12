package clients

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

// Missing client or contact.
var ErrNotFound = errors.New("not found")

// List returns clients with filter/sort and total count.
func (r *Repo) List(ctx context.Context, f ListFilter) (ListResult, error) {
	args := []any{}
	addArg := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(len(args))
	}
	where := strings.Builder{}
	if f.Q != "" {
		p := addArg("%" + f.Q + "%")
		where.WriteString(" AND (cc.name ILIKE " + p +
			" OR cc.number ILIKE " + p +
			" OR cc.npwp ILIKE " + p +
			" OR co.name ILIKE " + p + ")")
	}
	if f.IsActive != nil {
		p := addArg(*f.IsActive)
		where.WriteString(" AND cc.is_active = " + p)
	}
	if f.CountryCode != "" {
		p := addArg(f.CountryCode)
		where.WriteString(" AND cc.country_code = " + p)
	}
	if f.MinTotal != nil {
		p := addArg(*f.MinTotal)
		where.WriteString(" AND COALESCE((SELECT SUM(q.grand_total) FROM quotations q" +
			" WHERE q.company_client_id = cc.id AND q.status = 'accepted'), 0) >= " + p + "::numeric")
	}

	var out ListResult
	countSQL := r.store.Get("clients.list_count_base") + where.String()
	if err := r.db.QueryRow(ctx, countSQL, args...).Scan(&out.Total); err != nil {
		return out, err
	}

	sortBy := "cc.name"
	switch f.SortBy {
	case "createdAt", "created_at":
		sortBy = "cc.created_at"
	case "totalPurchase", "total_purchase":
		sortBy = "COALESCE((SELECT SUM(q.grand_total) FROM quotations q" +
			" WHERE q.company_client_id = cc.id AND q.status = 'accepted'), 0)"
	case "quotationCount", "quotation_count":
		sortBy = "(SELECT COUNT(*) FROM quotations q WHERE q.company_client_id = cc.id)"
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
	dataSQL := r.store.Get("clients.list_base") +
		where.String() +
		" ORDER BY " + sortBy + " " + sortDir +
		" LIMIT " + dataAdd(limit) + " OFFSET " + dataAdd(f.Offset)

	rows, err := r.db.Query(ctx, dataSQL, dataArgs...)
	if err != nil {
		return out, err
	}
	out.Rows, err = pgx.CollectRows(rows, pgx.RowToStructByName[Client])
	if out.Rows == nil {
		out.Rows = []Client{}
	}
	return out, err
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
