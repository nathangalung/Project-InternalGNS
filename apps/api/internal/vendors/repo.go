package vendors

import (
	"context"
	"errors"
	"fmt"

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

var ErrNotFound = errors.New("not found")

// ErrInUse marks a used vendor.
var ErrInUse = errors.New("vendor in use")

// ErrNoTx marks a non-transactional executor.
var ErrNoTx = errors.New("vendors: executor cannot begin a transaction")

// totalPurchaseExpr sums accepted costs.
// A deal counts at its PO line costs, since PO lines can be edited after
// acceptance and the dashboard books them, each line under the vendor it
// stores, so a vendor swapped in Ubah PO takes the cost with it; a deal with
// no PO yet counts at its quotation cost, and a cancelled PO drops it.
// Matches total_purchase in vendors.sql.
const totalPurchaseExpr = "COALESCE((SELECT SUM(c.cost) FROM (" +
	"SELECT poi.total_cost AS cost FROM purchase_order_items poi" +
	" JOIN purchase_orders po ON po.id = poi.po_id" +
	" JOIN vendor_products vp ON vp.id = poi.vendor_product_id" +
	" WHERE vp.vendor_id = v.id AND po.status <> 'CANCELLED'" +
	" UNION ALL" +
	" SELECT qi.total_cost FROM quotation_items qi" +
	" JOIN vendor_products vp ON vp.id = qi.vendor_product_id" +
	" JOIN quotations q ON q.id = qi.quotation_id" +
	" WHERE vp.vendor_id = v.id AND q.status = 'accepted'" +
	" AND NOT EXISTS (SELECT 1 FROM purchase_orders po WHERE po.quotation_id = q.id)) c), 0)"

// productCountExpr counts listed products.
// Only active links to active items count, the rows vendors.list_items
// pages. Matches product_count in vendors.sql.
const productCountExpr = "(SELECT COUNT(*) FROM vendor_products vp" +
	" JOIN items i ON i.id = vp.item_id AND i.is_active = TRUE" +
	" WHERE vp.vendor_id = v.id AND vp.is_active = TRUE)"

// sortable lists vendor sort keys.
var sortable = listq.Whitelist{
	Default: "name",
	Columns: map[string]listq.Column{
		"name":           {Expr: "v.name", Dir: listq.Asc},
		"createdAt":      {Expr: "v.created_at", Dir: listq.Desc},
		"created_at":     {Expr: "v.created_at", Dir: listq.Desc},
		"totalPurchase":  {Expr: totalPurchaseExpr, Dir: listq.Desc},
		"total_purchase": {Expr: totalPurchaseExpr, Dir: listq.Desc},
		"productCount":   {Expr: productCountExpr, Dir: listq.Desc},
		"product_count":  {Expr: productCountExpr, Dir: listq.Desc},
	},
}

// tiebreak keeps paging stable.
var tiebreak = listq.Column{Expr: "v.id", Dir: listq.Desc}

// List pages vendors with total.
func (r *Repo) List(ctx context.Context, f ListFilter) (ListResult, error) {
	c := listq.New()
	if f.Q != "" {
		p := c.Arg(listq.Contains(f.Q))
		c.And("(v.name ILIKE " + p + " OR v.location ILIKE " + p + ")")
	}
	if f.IsActive != nil {
		p := c.Arg(*f.IsActive)
		c.And("v.is_active = " + p)
	}
	if f.CountryName != "" {
		p := c.Arg(listq.Contains(f.CountryName))
		c.And("v.location ILIKE " + p)
	}
	if f.MinTotal != nil {
		p := c.Arg(*f.MinTotal)
		c.And(totalPurchaseExpr + " >= " + p + "::numeric")
	}

	var out ListResult
	countSQL, countArgs := c.Count(r.store.Get("vendors.list_count_base"))
	if err := r.db.QueryRow(ctx, countSQL, countArgs...).Scan(&out.Total); err != nil {
		return out, err
	}

	dataSQL, dataArgs := c.Data(
		r.store.Get("vendors.list_base"),
		listq.OrderBy(sortable, f.SortBy, f.SortDir, tiebreak),
		listq.Page(f.Limit, f.Offset),
	)

	rows, err := r.db.Query(ctx, dataSQL, dataArgs...)
	if err != nil {
		return out, err
	}
	out.Rows, err = pgx.CollectRows(rows, pgx.RowToStructByName[Vendor])
	if out.Rows == nil {
		out.Rows = []Vendor{}
	}
	return out, err
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
		req.Name, req.Location, req.ContactInfo, req.IsActive, userID,
	)
	if err != nil {
		return Vendor{}, err
	}
	return pgx.CollectOneRow(rows, pgx.RowToStructByName[Vendor])
}

// Update edits a vendor row.
func (r *Repo) Update(ctx context.Context, id int64, req UpdateVendorRequest, userID int64) (Vendor, error) {
	rows, err := r.db.Query(ctx, r.store.Get("vendors.update"),
		id, req.Name, req.Location, req.ContactInfo, req.IsActive, userID,
	)
	if err != nil {
		return Vendor{}, err
	}
	v, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[Vendor])
	if errors.Is(err, pgx.ErrNoRows) {
		return Vendor{}, ErrNotFound
	}
	return v, err
}

// UpdateLogo stores the logo key.
func (r *Repo) UpdateLogo(ctx context.Context, id int64, objectKey string, userID int64) error {
	tag, err := r.db.Exec(ctx, r.store.Get("vendors.update_logo"), id, objectKey, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ListItems pages vendor items.
func (r *Repo) ListItems(ctx context.Context, vendorID int64, limit, offset int) (ItemListResult, error) {
	var out ItemListResult
	if err := r.db.QueryRow(ctx, r.store.Get("vendors.list_items_count"), vendorID).Scan(&out.Total); err != nil {
		return out, fmt.Errorf("count vendor %d items: %w", vendorID, err)
	}
	rows, err := r.db.Query(ctx, r.store.Get("vendors.list_items"), vendorID, limit, offset)
	if err != nil {
		return out, fmt.Errorf("list vendor %d items: %w", vendorID, err)
	}
	out.Rows, err = pgx.CollectRows(rows, pgx.RowToStructByName[ItemByVendor])
	if err != nil {
		return out, fmt.Errorf("scan vendor %d items: %w", vendorID, err)
	}
	return out, nil
}

// Usage counts documents using a vendor.
// A document counts once, however many of its lines use the vendor.
type Usage struct {
	Quotations     int64
	PurchaseOrders int64
}

// Uses lists the non-zero counts.
// Each reads as "3 quotation", the way the 409 detail prints it.
func (u Usage) Uses() []string {
	var out []string
	if u.Quotations > 0 {
		out = append(out, fmt.Sprintf("%d quotation", u.Quotations))
	}
	if u.PurchaseOrders > 0 {
		out = append(out, fmt.Sprintf("%d PO", u.PurchaseOrders))
	}
	return out
}

// Delete removes an unused vendor.
// The vendor and its links are locked without waiting, the documents with
// a line through a link counted, and only with none are the links and the
// vendor deleted, all in one transaction; the linked items stay. It
// returns the deleted name, or ErrInUse with the usage. A lock another
// transaction holds fails with SQLSTATE 55P03.
func (r *Repo) Delete(ctx context.Context, id int64) (string, Usage, error) {
	b, ok := r.db.(db.TxBeginner)
	if !ok {
		return "", Usage{}, ErrNoTx
	}
	var name string
	var usage Usage
	err := db.WithTx(ctx, b, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, r.store.Get("vendors.lock_for_delete"), id).Scan(&name)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("lock vendor %d: %w", id, err)
		}
		if _, err := tx.Exec(ctx, r.store.Get("vendors.lock_links_for_delete"), id); err != nil {
			return fmt.Errorf("lock vendor %d links: %w", id, err)
		}
		if err := tx.QueryRow(ctx, r.store.Get("vendors.usage"), id).
			Scan(&usage.Quotations, &usage.PurchaseOrders); err != nil {
			return fmt.Errorf("count vendor %d usage: %w", id, err)
		}
		if len(usage.Uses()) > 0 {
			return ErrInUse
		}
		if _, err := tx.Exec(ctx, r.store.Get("vendors.delete_links"), id); err != nil {
			return fmt.Errorf("delete vendor %d links: %w", id, err)
		}
		if _, err := tx.Exec(ctx, r.store.Get("vendors.delete"), id); err != nil {
			return fmt.Errorf("delete vendor %d: %w", id, err)
		}
		return nil
	})
	return name, usage, err
}

// RecentQuotations lists the newest quotations.
// Only quotations that reached the client count (every status but draft
// and cancelled), newest first; these are the lines supplied through the vendor.
func (r *Repo) RecentQuotations(ctx context.Context, id int64) ([]VendorQuotation, error) {
	rows, err := r.db.Query(ctx, r.store.Get("vendors.recent_quotations"), id, RecentQuotationCount)
	if err != nil {
		return nil, fmt.Errorf("recent quotations: %w", err)
	}
	out, err := pgx.CollectRows(rows, pgx.RowToStructByName[VendorQuotation])
	if err != nil {
		return nil, fmt.Errorf("recent quotations: %w", err)
	}
	// Always a list, so the web never reads null.
	return append([]VendorQuotation{}, out...), nil
}
