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
	"github.com/nathangalung/internalgns/apps/api/internal/shared/validate"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// A PO line code is an IMPA code.
// A marked one is stored as six digits; anything else is refused on its
// field before the line is touched.
func TestHandler_UpdateItems_ItemCode(t *testing.T) {
	cases := []struct {
		name, code, want string
		refused          bool
	}{
		{"marked code", "IMPA 611234", "611234", false},
		{"not six digits", strings.Repeat("C", 21), "", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx, srv := txServer(t)
			_, poID := acceptedQuotationWithPO(t, tx)
			repo := purchaseorders.NewRepo(tx, testutil.Store(t))
			before, err := repo.GetByID(ctx, poID)
			require.NoError(t, err)
			res := doJSONWithHeaders(t, srv, http.MethodPut, fmt.Sprintf("/purchase-orders/%d/items", poID),
				itemsWith(purchaseorders.UpdateItemsLine{ItemCode: strPtr(tc.code)}),
				map[string]string{"If-Match": strconv.Itoa(int(before.RowVersion))})
			defer res.Body.Close()
			if tc.refused {
				require.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
				assert.Equal(t, map[string]string{"items[0].itemCode": validate.IMPAMessage}, readProblem(t, res).Fields)
				return
			}
			require.Less(t, res.StatusCode, 300)
			lines, err := repo.ListItems(ctx, poID)
			require.NoError(t, err)
			require.NotEmpty(t, lines)
			require.NotNil(t, lines[0].ItemCode)
			assert.Equal(t, tc.want, *lines[0].ItemCode)
		})
	}
}

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
