package purchaseorders_test

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// requireCheckViolation expects a CHECK refusal.
func requireCheckViolation(t *testing.T, err error) {
	t.Helper()
	var pgErr *pgconn.PgError
	require.True(t, errors.As(err, &pgErr), "want a database error, got %v", err)
	assert.Equal(t, db.SQLStateCheckViolation, pgErr.Code, pgErr.Message)
}

// Database refuses NaN, negative costs.
// NaN also slips past the priced-line guard, since NaN <= 0 is false.
func TestDB_POLineNumbersChecked(t *testing.T) {
	cases := []struct {
		name  string
		spoil func(*purchaseorders.UpdateItemsLine)
	}{
		{"qty NaN", func(l *purchaseorders.UpdateItemsLine) { l.Qty = "NaN" }},
		{"selling NaN", func(l *purchaseorders.UpdateItemsLine) { l.SellingPrice = "NaN" }},
		{"cost NaN", func(l *purchaseorders.UpdateItemsLine) { l.CostPrice = strPtr("NaN") }},
		{"cost negative", func(l *purchaseorders.UpdateItemsLine) { l.CostPrice = strPtr("-900000") }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			_, poID := acceptedQuotationWithPO(t, tx)
			req := itemsWith(purchaseorders.UpdateItemsLine{})
			c.spoil(&req.Items[0])
			_, err := purchaseorders.NewRepo(tx, testutil.Store(t)).UpdateItems(ctx, poID, req, seedUserID, nil)
			requireCheckViolation(t, err)
		})
	}
}

// Invoice lines refuse bad numbers.
func TestDB_InvoiceLineNumbersChecked(t *testing.T) {
	sets := []string{
		"qty = 'NaN'",
		"unit_price = 'NaN'",
		"gross_unit_price = 'NaN'",
		"cost_price = 'NaN'",
		"cost_price = -1",
	}
	for _, set := range sets {
		t.Run(set, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			_, poID := poAt(t, tx, purchaseorders.StatusDelivered)
			_, err := tx.Exec(ctx, `UPDATE invoice_items SET `+set+`
				WHERE invoice_id = (SELECT id FROM invoices WHERE po_id = $1)`, poID)
			requireCheckViolation(t, err)
		})
	}
}

// putItems saves a PO edit.
func putItems(t *testing.T, req purchaseorders.UpdateItemsRequest) *http.Response {
	t.Helper()
	ctx, tx, srv := txServer(t)
	_, poID := acceptedQuotationWithPO(t, tx)
	po, err := purchaseorders.NewRepo(tx, testutil.Store(t)).GetByID(ctx, poID)
	require.NoError(t, err)
	return doJSONWithHeaders(t, srv, http.MethodPut, fmt.Sprintf("/purchase-orders/%d/items", poID),
		req, map[string]string{"If-Match": strconv.Itoa(int(po.RowVersion))})
}

// Line edits refuse bad numbers.
// NaN passes the >= 0 CHECKs and the priced-line guard, and a negative harga
// beli books a profit nobody made.
func TestHandler_UpdateItems_RefusesBadNumbers(t *testing.T) {
	addr := "Jl. Pelabuhan Raya No. 12"
	days := func(n int) *int { return &n }
	tests := []struct {
		name  string
		spoil func(*purchaseorders.UpdateItemsRequest)
		field string
		msg   string
	}{
		{"qty NaN", func(r *purchaseorders.UpdateItemsRequest) { r.Items[0].Qty = "NaN" },
			"items[0].qty", "Jumlah harus berupa angka 0 atau lebih."},
		{"qty negative", func(r *purchaseorders.UpdateItemsRequest) { r.Items[0].Qty = "-2" },
			"items[0].qty", "Jumlah harus berupa angka 0 atau lebih."},
		{"selling NaN", func(r *purchaseorders.UpdateItemsRequest) { r.Items[0].SellingPrice = "NaN" },
			"items[0].sellingPrice", "Harga jual harus berupa angka lebih dari 0."},
		{"selling zero", func(r *purchaseorders.UpdateItemsRequest) { r.Items[0].SellingPrice = "0" },
			"items[0].sellingPrice", "Harga jual harus berupa angka lebih dari 0."},
		{"selling negative", func(r *purchaseorders.UpdateItemsRequest) { r.Items[0].SellingPrice = "-1" },
			"items[0].sellingPrice", "Harga jual harus berupa angka lebih dari 0."},
		{"cost NaN", func(r *purchaseorders.UpdateItemsRequest) { r.Items[0].CostPrice = strPtr("NaN") },
			"items[0].costPrice", "Harga beli harus berupa angka 0 atau lebih."},
		{"cost negative", func(r *purchaseorders.UpdateItemsRequest) { r.Items[0].CostPrice = strPtr("-900000") },
			"items[0].costPrice", "Harga beli harus berupa angka 0 atau lebih."},
		{"shipping cost NaN", func(r *purchaseorders.UpdateItemsRequest) {
			r.ShippingAddress, r.ShippingCost = &addr, strPtr("NaN")
		}, "shippingCost", "Biaya pengiriman harus berupa angka 0 atau lebih."},
		{"shipping days zero", func(r *purchaseorders.UpdateItemsRequest) {
			r.ShippingAddress, r.ShippingDays = &addr, days(0)
		}, "shippingDays", "Waktu pengiriman harus antara 1 dan 365 hari."},
		{"shipping days negative", func(r *purchaseorders.UpdateItemsRequest) {
			r.ShippingAddress, r.ShippingDays = &addr, days(-3)
		}, "shippingDays", "Waktu pengiriman harus antara 1 dan 365 hari."},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := itemsWith(purchaseorders.UpdateItemsLine{})
			tc.spoil(&req)
			res := putItems(t, req)
			defer res.Body.Close()
			require.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
			assert.Equal(t, tc.msg, readProblem(t, res).Fields[tc.field])
		})
	}
}

// Qty 0 lines stay allowed.
// CLAUDE.md keeps it: a line can be zeroed while another carries the order.
func TestHandler_UpdateItems_AllowsZeroQtyLine(t *testing.T) {
	req := itemsWith(purchaseorders.UpdateItemsLine{})
	zero := req.Items[0]
	zero.Qty = "0"
	req.Items = append(req.Items, zero)
	res := putItems(t, req)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}
