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
		{name: "zero price", req: priced("0"), detail: "Semua baris produk harus memiliki harga jual."},
		{name: "blank price", req: priced(""), detail: "Semua baris produk harus memiliki harga jual."},
		{name: "negative price", req: priced("-1"), detail: "Semua baris produk harus memiliki harga jual."},
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
