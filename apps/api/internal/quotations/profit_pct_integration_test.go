package quotations_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/live"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/roles"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// A low harga beli still saves.
//
// Operational input changes harga beli on a line a superadmin priced, with
// the body the product dialog sends: no harga jual, the line's vendor link,
// the request's code. The first case is the body v0.37 sent for a typed
// "400.000" (production quotation 820, line 6063); the second is a real
// line whose profit passes 1000 percent. Both overflowed profit_pct
// NUMERIC(7,4) into a 422 before migration 00119.
func TestHandler_InputCostSaveWithWideProfit(t *testing.T) {
	tests := []struct {
		name    string
		selling string
		cost    string
		pct     string
	}{
		{"v0.37 body for typed 400.000", "900000", "400", "2249.0000"},
		{"cost 1.000 against 1.100.000", "1100000", "1000", "1099.0000"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			srv := liveServer(t, live.NewHub())
			req := sampleCreate()
			line := offered()
			line.Qty, line.SellingPrice, line.CostPrice = "4", tc.selling, strPtr("385000")
			req.Items = []quotations.CreateItem{line}
			res := doJSON(t, srv, http.MethodPost, "/quotations/", req)
			require.Equal(t, http.StatusCreated, res.StatusCode)
			var created quotations.CreatedResponse
			require.NoError(t, json.NewDecoder(res.Body).Decode(&created))
			res.Body.Close()

			var lineID int64
			require.NoError(t, testutil.Pool(t).QueryRow(context.Background(), `
				SELECT id FROM quotation_items WHERE quotation_id = $1 AND item_type = 'product'`,
				created.ID).Scan(&lineID))
			base := "/quotations/" + strconv.FormatInt(created.ID, 10)
			in := asRole(roles.OperationalInput)
			res = doJSONWithHeaders(t, srv, http.MethodPost, base+"/locks",
				quotations.LockRequest{Part: quotations.LinePart(lineID)}, in)
			res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)

			body := json.RawMessage(fmt.Sprintf(`{"requestedItemId":%d,"requestedImpa":"990001",`+
				`"requestedName":"PUNCHING TOOL SET","offeredItemId":%d,"qty":"4","unitId":%d,`+
				`"vendorProductId":%d,"costPrice":%q}`,
				seedItemID, seedItemID, seedUnitID, seedVendorProd, tc.cost))
			res = doJSONWithHeaders(t, srv, http.MethodPut, base+"/lines/"+strconv.FormatInt(lineID, 10), body, in)
			if res.StatusCode != http.StatusNoContent {
				p := problemOf(t, res)
				t.Fatalf("line save: %d %s", p.Status, p.Detail)
			}
			res.Body.Close()

			var cost, selling, pct string
			require.NoError(t, testutil.Pool(t).QueryRow(context.Background(), `
				SELECT cost_price::text, selling_price::text, profit_pct::text
				FROM quotation_items WHERE id = $1`, lineID).Scan(&cost, &selling, &pct))
			assert.Equal(t, tc.cost+".00", cost, "harga beli is theirs to set")
			assert.Equal(t, tc.selling+".00", selling, "harga jual stays as the head set it")
			assert.Equal(t, tc.pct, pct)
		})
	}
}
