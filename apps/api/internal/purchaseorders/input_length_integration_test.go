package purchaseorders_test

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Over-length text is refused (PO-08).
// Each value is one character over its varchar limit. The PO audit saw
// a 500 here; the answer must be a 422 with Indonesian prose.
func TestHandler_OverLengthInputIsUnprocessable(t *testing.T) {
	tests := []struct {
		name   string
		method string
		suffix string
		body   func(poID int64) any
	}{
		{
			name: "po number over 50", method: http.MethodPatch, suffix: "/details",
			body: func(int64) any {
				return purchaseorders.UpdateDetailsRequest{PoNumber: strings.Repeat("9", 51), PoDate: "2026-01-15"}
			},
		},
		{
			name: "file name over 255", method: http.MethodPatch, suffix: "/file",
			body: func(poID int64) any {
				f := ownedPOFile(poID)
				f.FileName = strings.Repeat("a", 252) + ".pdf"
				return f
			},
		},
		{
			name: "item code over 20", method: http.MethodPut, suffix: "/items",
			body: func(int64) any {
				return itemsWith(purchaseorders.UpdateItemsLine{ItemCode: strPtr(strings.Repeat("C", 21))})
			},
		},
		{
			name: "ship destination over 255", method: http.MethodPut, suffix: "/items",
			body: func(int64) any {
				return itemsWith(purchaseorders.UpdateItemsLine{ShipDestination: strPtr(strings.Repeat("d", 256))})
			},
		},
		{
			name: "shipping address over 255", method: http.MethodPut, suffix: "/items",
			body: func(int64) any {
				req := itemsWith(purchaseorders.UpdateItemsLine{})
				req.ShippingAddress = strPtr(strings.Repeat("d", 256))
				return req
			},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx, srv := txServer(t)
			_, poID := acceptedQuotationWithPO(t, tx)
			repo := purchaseorders.NewRepo(tx, testutil.Store(t))
			before, err := repo.GetByID(ctx, poID)
			require.NoError(t, err)

			res := doJSONWithHeaders(t, srv, tc.method, fmt.Sprintf("/purchase-orders/%d%s", poID, tc.suffix),
				tc.body(poID), map[string]string{"If-Match": strconv.Itoa(int(before.RowVersion))})
			defer res.Body.Close()
			require.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
			assert.Equal(t, "Isian terlalu panjang. Persingkat isian lalu simpan kembali.", readProblem(t, res).Detail)
		})
	}
}

// itemsWith builds a one-line edit.
func itemsWith(line purchaseorders.UpdateItemsLine) purchaseorders.UpdateItemsRequest {
	line.ItemName = "Barang"
	line.Qty = "1"
	line.SellingPrice = "1000"
	line.UnitID = int16Ptr(seedUnitID)
	return purchaseorders.UpdateItemsRequest{DiscountPct: "0", Items: []purchaseorders.UpdateItemsLine{line}}
}
