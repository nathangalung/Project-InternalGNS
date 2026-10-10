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

// ErrInUse marks a client documents use.
var ErrInUse = errors.New("client in use")

// ErrNoTx marks a non-transactional executor.
var ErrNoTx = errors.New("clients: executor cannot begin a transaction")

// ErrEmailTaken marks taken emails.
// Another active contact, at any client, owns the email.
var ErrEmailTaken = errors.New("contact email taken")

// totalPurchaseExpr sums accepted deals.
// Each deal counts at its PO grand total, since PO lines can be edited after
// acceptance and are what is invoiced, or at its quotation total while it
// has no PO; a cancelled PO drops the deal. Matches total_purchase in
// clients.sql.
const totalPurchaseExpr = "COALESCE((SELECT SUM(CASE WHEN po.id IS NULL THEN q.grand_total" +
	" ELSE (SELECT t.po_grand_total FROM v_po_totals t WHERE t.po_id = po.id) END)" +
	" FROM quotations q LEFT JOIN purchase_orders po ON po.quotation_id = q.id" +
	" WHERE q.company_client_id = cc.id AND q.status = 'accepted'" +
	" AND po.status IS DISTINCT FROM 'CANCELLED'), 0)"

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
		p := c.Arg(listq.Contains(f.Q))
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
// No row back means the client is missing.
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
		return Client{}, ErrNotFound
	}
	return c, numberErr(err)
}

// numberErr maps number refusals.
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

// GetContact reads one contact.
// A deactivated contact is returned too; ErrNotFound when the company has
// no contact with that id.
func (r *Repo) GetContact(ctx context.Context, companyID, contactID int64) (Contact, error) {
	rows, err := r.db.Query(ctx, r.store.Get("clients.get_contact"), companyID, contactID)
	if err != nil {
		return Contact{}, err
	}
	c, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[Contact])
	if errors.Is(err, pgx.ErrNoRows) {
		return Contact{}, ErrNotFound
	}
	return c, err
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
		return Contact{}, emailErr(err)
	}
	c, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[Contact])
	return c, emailErr(err)
}

// emailErr marks taken emails.
// The database error stays wrapped for the generic conflict.
func emailErr(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.ConstraintName == "idx_company_contacts_email" {
		return fmt.Errorf("%w: %w", ErrEmailTaken, err)
	}
	return err
}

// UpdateContact edits an active contact.
// ErrNotFound when the contact belongs to another company or was deleted.
func (r *Repo) UpdateContact(ctx context.Context, companyID, contactID int64, req UpdateContactRequest, userID int64) (Contact, error) {
	rows, err := r.db.Query(ctx, r.store.Get("clients.update_contact"),
		companyID, contactID, req.Name, req.Email.Set, req.Email.Value, req.Phone,
		req.Title.Set, req.Title.Value, req.CountryCode, userID,
	)
	if err != nil {
		return Contact{}, emailErr(err)
	}
	c, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[Contact])
	if errors.Is(err, pgx.ErrNoRows) {
		return Contact{}, ErrNotFound
	}
	return c, emailErr(err)
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

// Usage counts documents using a client.
type Usage struct {
	Quotations     int64
	PurchaseOrders int64
	Invoices       int64
}

// Uses lists the non-zero counts.
// Each reads as "3 quotation", the way the 409 detail prints it.
func (u Usage) Uses() []string {
	var out []string
	for _, c := range []struct {
		n    int64
		noun string
	}{{u.Quotations, "quotation"}, {u.PurchaseOrders, "PO"}, {u.Invoices, "invoice"}} {
		if c.n > 0 {
			out = append(out, fmt.Sprintf("%d %s", c.n, c.noun))
		}
	}
	return out
}

// Delete removes an unused client.
// The client and its contacts are locked without waiting, the documents
// using them counted, and only with none are the contacts and the client
// deleted, all in one transaction. It returns the deleted name, or
// ErrInUse with the usage. A lock another transaction holds fails with
// SQLSTATE 55P03.
func (r *Repo) Delete(ctx context.Context, id int64) (string, Usage, error) {
	b, ok := r.db.(db.TxBeginner)
	if !ok {
		return "", Usage{}, ErrNoTx
	}
	var name string
	var usage Usage
	err := db.WithTx(ctx, b, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, r.store.Get("clients.lock_for_delete"), id).Scan(&name)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("lock client %d: %w", id, err)
		}
		if _, err := tx.Exec(ctx, r.store.Get("clients.lock_contacts_for_delete"), id); err != nil {
			return fmt.Errorf("lock client %d contacts: %w", id, err)
		}
		if err := tx.QueryRow(ctx, r.store.Get("clients.usage"), id).
			Scan(&usage.Quotations, &usage.PurchaseOrders, &usage.Invoices); err != nil {
			return fmt.Errorf("count client %d usage: %w", id, err)
		}
		if len(usage.Uses()) > 0 {
			return ErrInUse
		}
		if _, err := tx.Exec(ctx, r.store.Get("clients.delete_contacts"), id); err != nil {
			return fmt.Errorf("delete client %d contacts: %w", id, err)
		}
		if _, err := tx.Exec(ctx, r.store.Get("clients.delete"), id); err != nil {
			return fmt.Errorf("delete client %d: %w", id, err)
		}
		return nil
	})
	return name, usage, err
}

// RecentQuotations lists the newest quotations.
// Only quotations that reached the client count (every status but draft
// and cancelled), newest first.
func (r *Repo) RecentQuotations(ctx context.Context, id int64) ([]ClientQuotation, error) {
	rows, err := r.db.Query(ctx, r.store.Get("clients.recent_quotations"), id, RecentQuotationCount)
	if err != nil {
		return nil, fmt.Errorf("recent quotations: %w", err)
	}
	out, err := pgx.CollectRows(rows, pgx.RowToStructByName[ClientQuotation])
	if err != nil {
		return nil, fmt.Errorf("recent quotations: %w", err)
	}
	// Always a list, so the web never reads null.
	return append([]ClientQuotation{}, out...), nil
}
