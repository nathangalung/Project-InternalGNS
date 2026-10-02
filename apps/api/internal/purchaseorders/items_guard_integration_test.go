package purchaseorders_test

import (
	"fmt"
	"net/http"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Edits keep a priced product.
// An edit that empties or unprices the product lines would deliver into a
// Rp 0 invoice, so fn_update_po_items refuses it as the quotation does.
func TestHandler_UpdateItems_RequiresPricedProduct(t *testing.T) {
	addr := "Jl. Pelabuhan Raya No. 12"
	cost := "50000"
	priced := func(price string) purchaseorders.UpdateItemsRequest {
		req := itemsWith(purchaseorders.UpdateItemsLine{})
		req.Items[0].SellingPrice = price
		return req
	}
	tests := []struct {
		name   string
		req    purchaseorders.UpdateItemsRequest
		detail string
	}{
		{
			name:   "no lines",
			req:    purchaseorders.UpdateItemsRequest{DiscountPct: "0", Items: []purchaseorders.UpdateItemsLine{}},
			detail: "PO harus memiliki minimal satu baris produk.",
		},
		{
			name: "shipping only",
			req: purchaseorders.UpdateItemsRequest{
				DiscountPct: "0", ShippingAddress: &addr, ShippingCost: &cost,
				Items: []purchaseorders.UpdateItemsLine{},
			},
			detail: "PO harus memiliki minimal satu baris produk.",
		},
		{name: "blank price", req: priced(""), detail: "Semua baris produk harus memiliki harga jual."},
		// A zero or negative price stops at the handler; see RefusesBadNumbers.
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx, srv := txServer(t)
			_, poID := acceptedQuotationWithPO(t, tx)
			po, err := purchaseorders.NewRepo(tx, testutil.Store(t)).GetByID(ctx, poID)
			require.NoError(t, err)

			res := doJSONWithHeaders(t, srv, http.MethodPut, fmt.Sprintf("/purchase-orders/%d/items", poID),
				tc.req, map[string]string{"If-Match": strconv.Itoa(int(po.RowVersion))})
			defer res.Body.Close()
			require.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
			assert.Equal(t, tc.detail, readProblem(t, res).Detail)
		})
	}
}

// Work needs a priced product.
// Lines that reached the table another way still cannot start work or be
// delivered, so no Rp 0 invoice is issued.
func TestRepo_ChangeStatus_RequiresPricedProduct(t *testing.T) {
	const msg = "PO harus memiliki minimal satu baris produk dan setiap baris produk harus memiliki harga jual. Lengkapi melalui Ubah PO."
	lines := []struct {
		name string
		sql  string
	}{
		{"no product lines", `DELETE FROM purchase_order_items WHERE po_id = $1 AND item_type = 'product'`},
		{"unpriced product", `UPDATE purchase_order_items SET selling_price = 0 WHERE po_id = $1 AND item_type = 'product'`},
	}
	moves := []struct {
		from, to purchaseorders.Status
	}{
		{purchaseorders.StatusUploaded, purchaseorders.StatusOnProgress},
		{purchaseorders.StatusOnProgress, purchaseorders.StatusDelivered},
	}
	for _, line := range lines {
		for _, mv := range moves {
			t.Run(line.name+" to "+string(mv.to), func(t *testing.T) {
				ctx, tx := testutil.BeginTx(t)
				_, poID := poAt(t, tx, mv.from)
				_, err := tx.Exec(ctx, line.sql, poID)
				require.NoError(t, err)

				err = purchaseorders.NewRepo(tx, testutil.Store(t)).ChangeStatus(ctx, poID, mv.to, seedUserID)
				require.ErrorIs(t, err, purchaseorders.ErrInvalidTransition)
				assert.Equal(t, msg, err.Error())
			})
		}
	}
}

// Work needs a nonzero quantity.
// One qty 0 line is allowed, but when every product line is 0 the PO
// would deliver into a Rp 0 invoice.
func TestRepo_ChangeStatus_RequiresQuantity(t *testing.T) {
	const msg = "Jumlah semua baris produk masih 0. Isi jumlah minimal satu baris produk melalui Ubah PO."
	moves := []struct {
		from, to purchaseorders.Status
	}{
		{purchaseorders.StatusUploaded, purchaseorders.StatusOnProgress},
		{purchaseorders.StatusOnProgress, purchaseorders.StatusDelivered},
	}
	for _, mv := range moves {
		t.Run("every line zero to "+string(mv.to), func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			_, poID := poAt(t, tx, mv.from)
			_, err := tx.Exec(ctx, `UPDATE purchase_order_items SET qty = 0 WHERE po_id = $1 AND item_type = 'product'`, poID)
			require.NoError(t, err)

			err = purchaseorders.NewRepo(tx, testutil.Store(t)).ChangeStatus(ctx, poID, mv.to, seedUserID)
			require.ErrorIs(t, err, purchaseorders.ErrInvalidTransition)
			assert.Equal(t, msg, err.Error())
		})
	}

	t.Run("one zero line still delivers", func(t *testing.T) {
		ctx, tx := testutil.BeginTx(t)
		_, poID := poAt(t, tx, purchaseorders.StatusOnProgress)
		repo := purchaseorders.NewRepo(tx, testutil.Store(t))
		req := itemsWith(purchaseorders.UpdateItemsLine{ShipDestination: strPtr("Kapal Uji")})
		zero := req.Items[0]
		zero.Qty = "0"
		req.Items = append(req.Items, zero)
		_, err := repo.UpdateItems(ctx, poID, req, seedUserID, nil)
		require.NoError(t, err)

		require.NoError(t, repo.ChangeStatus(ctx, poID, purchaseorders.StatusDelivered, seedUserID))
		var qty, subtotal string
		require.NoError(t, tx.QueryRow(ctx, `
			SELECT ii.qty::text, (ii.qty * ii.unit_price)::text
			FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
			WHERE i.po_id = $1 AND ii.line_type = 'product' ORDER BY ii.line_number DESC LIMIT 1`,
			poID).Scan(&qty, &subtotal))
		assert.Equal(t, "0.00", qty)
		assert.Equal(t, "0.0000", subtotal)
	})
}
