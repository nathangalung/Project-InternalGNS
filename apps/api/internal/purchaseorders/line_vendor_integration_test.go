package purchaseorders_test

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// insertVendor adds a vendor.
// A blank location leaves the vendor incomplete for the work gate.
func insertVendor(t *testing.T, tx pgx.Tx, name, location string, active bool) int64 {
	t.Helper()
	var id int64
	require.NoError(t, tx.QueryRow(context.Background(), `
		INSERT INTO vendors (name, location, contact_info, is_active, created_by, updated_by)
		VALUES ($1, NULLIF($2, ''), '{"email":"vendor@test.local"}'::jsonb, $3, $4, $4)
		RETURNING id`, name, location, active, seedUserID).Scan(&id))
	return id
}

// linkVendorItem links a vendor to an item.
func linkVendorItem(t *testing.T, tx pgx.Tx, vendorID, itemID int64, cost string) int64 {
	t.Helper()
	var id int64
	require.NoError(t, tx.QueryRow(context.Background(), `
		INSERT INTO vendor_products (vendor_id, item_id, cost_price, created_by, updated_by)
		VALUES ($1, $2, $3::numeric, $4, $4)
		RETURNING id`, vendorID, itemID, cost, seedUserID).Scan(&id))
	return id
}

// firstProductLine reads the stored line.
func firstProductLine(t *testing.T, tx pgx.Tx, poID int64) (qiID, vpID *int64) {
	t.Helper()
	require.NoError(t, tx.QueryRow(context.Background(), `
		SELECT quotation_item_id, vendor_product_id FROM purchase_order_items
		WHERE po_id = $1 AND item_type = 'product' ORDER BY line_number LIMIT 1`,
		poID).Scan(&qiID, &vpID))
	return qiID, vpID
}

// The PO line keeps its supplier.
// fn_create_purchase_order copies the quotation line's vendor link, and the
// items list reads it from the PO line.
func TestPurchaseOrder_CreateStoresLineVendor(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	poID := acceptedQuotationWithVendor(t, tx, seedCompanyID)

	qiID, vpID := firstProductLine(t, tx, poID)
	require.NotNil(t, qiID)
	require.NotNil(t, vpID)
	var quoted int64
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT vendor_product_id FROM quotation_items WHERE id = $1`, *qiID).Scan(&quoted))
	assert.Equal(t, quoted, *vpID)

	items, err := purchaseorders.NewRepo(tx, testutil.Store(t)).ListItems(ctx, poID)
	require.NoError(t, err)
	require.NotEmpty(t, items)
	assert.Equal(t, vpID, items[0].VendorProductID)
}

// A link for another product is dropped.
// A quotation line whose vendor link names another item would otherwise
// make the PO show, and gate on, a vendor that never offered the product.
func TestPurchaseOrder_CreateDropsForeignVendorLink(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	poID := acceptedQuotationWithVendor(t, tx, seedCompanyID)
	qiID, _ := firstProductLine(t, tx, poID)
	other := insertUncodedItem(t, tx)
	foreign := linkVendorItem(t, tx, insertVendor(t, tx, "CV Lain", "Medan", true), *other, "1000")

	// Re-create the PO from a quotation line with a foreign link.
	var qid int64
	require.NoError(t, tx.QueryRow(ctx,
		`UPDATE quotation_items SET vendor_product_id = $2 WHERE id = $1 RETURNING quotation_id`,
		*qiID, foreign).Scan(&qid))
	_, err := tx.Exec(ctx, `DELETE FROM purchase_orders WHERE id = $1`, poID)
	require.NoError(t, err)
	require.NoError(t, tx.QueryRow(ctx, `SELECT fn_create_purchase_order($1, $2)`, qid, seedUserID).Scan(&poID))

	_, vpID := firstProductLine(t, tx, poID)
	assert.Nil(t, vpID)
}

// The edit stores the picked vendor.
// A vendor chosen in Ubah PO used to be dropped on save, so the PO kept
// showing the quotation line's vendor; a vendor without a link to the item
// is linked the way a quotation links it.
func TestRepo_UpdateItems_StoresLineVendor(t *testing.T) {
	cases := []struct {
		name string
		// line sets the vendor and returns the vendor expected back
		line func(t *testing.T, tx pgx.Tx, l *purchaseorders.UpdateItemsLine) *int64
	}{
		{
			name: "linked vendor",
			line: func(t *testing.T, tx pgx.Tx, l *purchaseorders.UpdateItemsLine) *int64 {
				v := insertVendor(t, tx, "CV Pengganti", "Surabaya", true)
				link := linkVendorItem(t, tx, v, seedItemID, "40000")
				l.VendorProductID = &link
				return &v
			},
		},
		{
			name: "vendor without a link",
			line: func(t *testing.T, tx pgx.Tx, l *purchaseorders.UpdateItemsLine) *int64 {
				v := insertVendor(t, tx, "CV Baru", "Batam", true)
				l.VendorID = &v
				return &v
			},
		},
		{
			name: "link kept after its vendor is deactivated",
			line: func(t *testing.T, tx pgx.Tx, l *purchaseorders.UpdateItemsLine) *int64 {
				v := insertVendor(t, tx, "CV Lama", "Bitung", false)
				link := linkVendorItem(t, tx, v, seedItemID, "40000")
				_, err := tx.Exec(context.Background(),
					`UPDATE vendor_products SET is_active = FALSE WHERE id = $1`, link)
				require.NoError(t, err)
				l.VendorProductID = &link
				return &v
			},
		},
		{
			name: "no vendor",
			line: func(*testing.T, pgx.Tx, *purchaseorders.UpdateItemsLine) *int64 { return nil },
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			poID := acceptedQuotationWithVendor(t, tx, seedCompanyID)
			qiID, _ := firstProductLine(t, tx, poID)
			offered := seedItemID
			req := itemsWith(purchaseorders.UpdateItemsLine{
				QuotationItemID: qiID, OfferedItemID: &offered, CostPrice: strPtr("40000"),
			})
			want := tc.line(t, tx, &req.Items[0])
			repo := purchaseorders.NewRepo(tx, testutil.Store(t))

			_, err := repo.UpdateItems(ctx, poID, req, seedUserID, nil)
			require.NoError(t, err)

			items, err := repo.ListItems(ctx, poID)
			require.NoError(t, err)
			require.NotEmpty(t, items)
			assert.Equal(t, want, items[0].VendorID)
			if want == nil {
				assert.Nil(t, items[0].VendorProductID)
				return
			}
			var linked int64
			require.NoError(t, tx.QueryRow(ctx,
				`SELECT vendor_id FROM vendor_products WHERE id = $1 AND item_id = $2`,
				*items[0].VendorProductID, offered).Scan(&linked))
			assert.Equal(t, *want, linked)
		})
	}
}

// A line added in the edit is gated.
// Its vendor had no quotation line to resolve through, so the work gate
// never checked that vendor's data.
func TestRepo_Completeness_AddedLineVendor(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID := acceptedQuotationWithPO(t, tx)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	items, err := repo.ListItems(ctx, poID)
	require.NoError(t, err)
	require.NotEmpty(t, items)
	kept := purchaseorders.UpdateItemsLine{
		QuotationItemID: items[0].QuotationItemID, OfferedItemID: items[0].OfferedItemID,
		VendorProductID: items[0].VendorProductID, ShipDestination: strPtr("Kapal Uji"),
	}
	req := itemsWith(kept)
	vendor := insertVendor(t, tx, "CV Tanpa Lokasi", "", true)
	offered := seedItemID
	added := req.Items[0]
	added.QuotationItemID, added.VendorProductID = nil, nil
	added.OfferedItemID = &offered
	added.VendorID = &vendor
	req.Items = append(req.Items, added)

	_, err = repo.UpdateItems(ctx, poID, req, seedUserID, nil)
	require.NoError(t, err)

	issues, err := repo.Completeness(ctx, poID)
	require.NoError(t, err)
	var ids []int64
	for _, is := range issues {
		if is.Kind == purchaseorders.KindVendor {
			ids = append(ids, is.ID)
		}
	}
	assert.Equal(t, []int64{vendor}, ids)
}

// Foreign links are refused.
// A quotation line from another quotation, a vendor link for another
// product, a vendor with no product and an inactive vendor never reach
// the PO.
func TestHandler_UpdateItems_RefusesForeignLinks(t *testing.T) {
	cases := []struct {
		name   string
		line   func(t *testing.T, tx pgx.Tx, l *purchaseorders.UpdateItemsLine)
		detail string
	}{
		{
			name: "quotation line of another quotation",
			line: func(t *testing.T, tx pgx.Tx, l *purchaseorders.UpdateItemsLine) {
				otherPO := acceptedQuotationWithVendor(t, tx, seedCompanyID)
				l.QuotationItemID, _ = firstProductLine(t, tx, otherPO)
			},
			detail: "Baris quotation tidak termasuk dalam quotation PO ini.",
		},
		{
			name: "vendor link of another product",
			line: func(t *testing.T, tx pgx.Tx, l *purchaseorders.UpdateItemsLine) {
				other := insertUncodedItem(t, tx)
				link := linkVendorItem(t, tx, insertVendor(t, tx, "CV Lain", "Medan", true), *other, "1000")
				l.VendorProductID = &link
			},
			detail: "Vendor ini tidak menyediakan produk tersebut. Pilih vendor lain.",
		},
		{
			name: "unknown vendor link",
			line: func(_ *testing.T, _ pgx.Tx, l *purchaseorders.UpdateItemsLine) {
				missing := int64(-1)
				l.VendorProductID = &missing
			},
			detail: "Vendor ini tidak menyediakan produk tersebut. Pilih vendor lain.",
		},
		{
			name: "vendor without a product",
			line: func(t *testing.T, tx pgx.Tx, l *purchaseorders.UpdateItemsLine) {
				v := insertVendor(t, tx, "CV Tanpa Produk", "Medan", true)
				l.OfferedItemID = nil
				l.VendorID = &v
			},
			detail: "Pilih produk yang ditawarkan sebelum memilih vendor.",
		},
		{
			name: "inactive vendor",
			line: func(t *testing.T, tx pgx.Tx, l *purchaseorders.UpdateItemsLine) {
				v := insertVendor(t, tx, "CV Nonaktif", "Medan", false)
				l.VendorID = &v
			},
			detail: "Vendor tidak ditemukan atau sudah nonaktif. Pilih vendor lain.",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx, srv := txServer(t)
			_, poID := acceptedQuotationWithPO(t, tx)
			po, err := purchaseorders.NewRepo(tx, testutil.Store(t)).GetByID(ctx, poID)
			require.NoError(t, err)
			offered := seedItemID
			req := itemsWith(purchaseorders.UpdateItemsLine{OfferedItemID: &offered})
			tc.line(t, tx, &req.Items[0])

			res := doJSONWithHeaders(t, srv, http.MethodPut, fmt.Sprintf("/purchase-orders/%d/items", poID),
				req, map[string]string{"If-Match": strconv.Itoa(int(po.RowVersion))})
			defer res.Body.Close()
			require.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
			assert.Equal(t, tc.detail, readProblem(t, res).Detail)
		})
	}
}
