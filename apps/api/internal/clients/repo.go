package clients

import (
	"context"
	"errors"
	"fmt"

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

// Missing client or contact.
var ErrNotFound = errors.New("not found")

// Number malformed or already taken.
var ErrNumberInvalid = errors.New("client number invalid or taken")

// Number fixed by a quotation.
var ErrNumberLocked = errors.New("client number used by a quotation")

// totalPurchaseExpr sums accepted quotations.
// The sum is per client and skips deals whose PO was cancelled, matching
// total_purchase in clients.sql.
const totalPurchaseExpr = "COALESCE((SELECT SUM(q.grand_total) FROM quotations q" +
	" WHERE q.company_client_id = cc.id AND q.status = 'accepted'" +
	" AND NOT EXISTS (SELECT 1 FROM purchase_orders po" +
	" WHERE po.quotation_id = q.id AND po.status = 'CANCELLED')), 0)"

// sortable lists client sort keys.
var sortable = listq.Whitelist{
	Default: "name",
	Columns: map[string]listq.Column{
		"name":            {Expr: "cc.name", Dir: listq.Asc},
		"createdAt":       {Expr: "cc.created_at", Dir: listq.Desc},
		"created_at":      {Expr: "cc.created_at", Dir: listq.Desc},
		"totalPurchase":   {Expr: totalPurchaseExpr, Dir: listq.Desc},
		"total_purchase":  {Expr: totalPurchaseExpr, Dir: listq.Desc},
		"quotationCount":  {Expr: "(SELECT COUNT(*) FROM quotations q WHERE q.company_client_id = cc.id)", Dir: listq.Desc},
		"quotation_count": {Expr: "(SELECT COUNT(*) FROM quotations q WHERE q.company_client_id = cc.id)", Dir: listq.Desc},
	},
}

// tiebreak keeps paging stable.
var tiebreak = listq.Column{Expr: "cc.id", Dir: listq.Desc}

// List pages clients with total.
func (r *Repo) List(ctx context.Context, f ListFilter) (ListResult, error) {
	c := listq.New()
	if f.Q != "" {
		p := c.Arg(likeContains(f.Q))
		c.And("(cc.name ILIKE " + p +
			" OR cc.number ILIKE " + p +
			" OR cc.npwp ILIKE " + p +
			" OR co.name ILIKE " + p + ")")
	}
	if f.IsActive != nil {
		p := c.Arg(*f.IsActive)
		c.And("cc.is_active = " + p)
	}
	if f.CountryCode != "" {
		p := c.Arg(f.CountryCode)
		c.And("cc.country_code = " + p)
	}
	if f.MinTotal != nil {
		p := c.Arg(*f.MinTotal)
		c.And(totalPurchaseExpr + " >= " + p + "::numeric")
	}

	var out ListResult
	countSQL, countArgs := c.Count(r.store.Get("clients.list_count_base"))
	if err := r.db.QueryRow(ctx, countSQL, countArgs...).Scan(&out.Total); err != nil {
		return out, err
	}

	dataSQL, dataArgs := c.Data(
		r.store.Get("clients.list_base"),
		listq.OrderBy(sortable, f.SortBy, f.SortDir, tiebreak),
		listq.Page(f.Limit, f.Offset),
	)

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

// GetByIDs maps ids to clients.
// It takes one round-trip. Ids with no row are absent from the map; callers
// decide whether that is an error.
func (r *Repo) GetByIDs(ctx context.Context, ids []int64) (map[int64]Client, error) {
	out := map[int64]Client{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := r.db.Query(ctx, r.store.Get("clients.get_by_ids"), ids)
	if err != nil {
		return nil, err
	}
	found, err := pgx.CollectRows(rows, pgx.RowToStructByName[Client])
	if err != nil {
		return nil, err
	}
	for _, c := range found {
		out[c.ID] = c
	}
	return out, nil
}

// Create inserts a new client.
// A nil or blank number is assigned by the database.
func (r *Repo) Create(ctx context.Context, req CreateClientRequest, userID int64) (Client, error) {
	rows, err := r.db.Query(ctx, r.store.Get("clients.create"),
		req.Number, req.Name, req.NPWP, req.Address, req.Email,
		req.CountryCode, req.TkuID, userID,
	)
	if err != nil {
		return Client{}, numberErr(err)
	}
	c, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[Client])
	return c, numberErr(err)
}

// Update edits a client row.
// No row back means missing, or a number change on a quoted client.
func (r *Repo) Update(ctx context.Context, id int64, req UpdateClientRequest, userID int64) (Client, error) {
	rows, err := r.db.Query(ctx, r.store.Get("clients.update"),
		id, req.Name, req.NPWP, req.Address, req.Email,
		req.CountryCode, req.TkuID, req.IsActive, userID, req.Number,
	)
	if err != nil {
		return Client{}, numberErr(err)
	}
	c, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[Client])
	if errors.Is(err, pgx.ErrNoRows) {
		if _, err := r.GetByID(ctx, id); err != nil {
			return Client{}, fmt.Errorf("recheck client %d: %w", id, err)
		}
		return Client{}, ErrNumberLocked
	}
	return c, numberErr(err)
}

// numberErr maps number constraint violations.
func numberErr(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.ConstraintName {
		case "uq_company_client_number", "company_client_number_format_check":
			return fmt.Errorf("%w: %s", ErrNumberInvalid, pgErr.ConstraintName)
		}
	}
	return err
}

// UpdateLogo stores the logo key.
// An empty string is allowed and stored verbatim; pass NULL semantics through
// the SQL layer if a caller wants to clear it.
func (r *Repo) UpdateLogo(ctx context.Context, id int64, objectKey string, userID int64) error {
	tag, err := r.db.Exec(ctx, r.store.Get("clients.update_logo"), id, objectKey, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
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

// UpdateContact edits an active contact.
// ErrNotFound when the contact belongs to another company or was deleted.
func (r *Repo) UpdateContact(ctx context.Context, companyID, contactID int64, req UpdateContactRequest, userID int64) (Contact, error) {
	rows, err := r.db.Query(ctx, r.store.Get("clients.update_contact"),
		companyID, contactID, req.Name, req.Email.Set, req.Email.Value, req.Phone,
		req.Title.Set, req.Title.Value, req.CountryCode, userID,
	)
	if err != nil {
		return Contact{}, err
	}
	c, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[Contact])
	if errors.Is(err, pgx.ErrNoRows) {
		return Contact{}, ErrNotFound
	}
	return c, err
}

// DeactivateContact soft-deletes a contact.
func (r *Repo) DeactivateContact(ctx context.Context, companyID, contactID, userID int64) error {
	tag, err := r.db.Exec(ctx, r.store.Get("clients.deactivate_contact"), companyID, contactID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
