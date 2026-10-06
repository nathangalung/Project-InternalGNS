package purchaseorders_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/rolegate"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/roles"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

func asRole(role string) map[string]string { return map[string]string{roleHeader: role} }

// decodeMap decodes by key.
// A struct decode cannot tell an absent key from an empty one.
func decodeMap[T any](t *testing.T, res *http.Response) T {
	t.Helper()
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var v T
	require.NoError(t, json.NewDecoder(res.Body).Decode(&v))
	return v
}

// PO figures per role.
// Operational input sees harga beli, finance input harga jual, and only a
// role with both sees profit.
func TestHandler_POByRole(t *testing.T) {
	_, tx, srv := txServer(t)
	_, poID := acceptedQuotationWithPO(t, tx)
	path := fmt.Sprintf("/purchase-orders/%d", poID)

	selling := []string{"discountPct", "poSubtotal", "poTotalProduk", "poDppNilaiLain", "poPpnAmount", "poGrandTotal", "poTotalDiscount"}
	// A PENDING PO offers only Dibatalkan, which a head alone may take.
	tests := []struct {
		role                  string
		selling, cost, profit bool
		cancels               bool
	}{
		{roles.Superadmin, true, true, true, true},
		{roles.Operational, true, true, true, true},
		{roles.OperationalInput, false, true, false, false},
		{roles.Finance, true, true, true, false},
		{roles.FinanceInput, true, false, false, false},
	}
	for _, tt := range tests {
		t.Run(tt.role, func(t *testing.T) {
			po := decodeMap[map[string]any](t, doJSONWithHeaders(t, srv, http.MethodGet, path, nil, asRole(tt.role)))
			for _, k := range selling {
				assert.Equal(t, tt.selling, po[k] != nil, k)
			}
			assert.Equal(t, tt.profit, po["poTotalProfit"] != nil, "poTotalProfit")
			cancels := false
			for _, m := range po["allowedTransitions"].([]any) {
				cancels = cancels || m.(map[string]any)["to"] == string(purchaseorders.StatusCancelled)
			}
			assert.Equal(t, tt.cancels, cancels, "Dibatalkan offered")

			lines := decodeMap[[]map[string]any](t, doJSONWithHeaders(t, srv, http.MethodGet, path+"/items", nil, asRole(tt.role)))
			require.NotEmpty(t, lines)
			for _, l := range lines {
				if l["itemType"] != "product" {
					continue
				}
				assert.Equal(t, tt.selling, l["sellingPrice"] != nil, "sellingPrice")
				assert.Equal(t, tt.selling, l["totalSelling"] != nil, "totalSelling")
				assert.Equal(t, tt.cost, l["costPrice"] != nil, "costPrice")
				assert.Equal(t, tt.profit, l["profitAmount"] != nil, "profitAmount")
			}

			rows := decodeMap[[]map[string]any](t, doJSONWithHeaders(t, srv, http.MethodGet, "/purchase-orders/", nil, asRole(tt.role)))
			for _, row := range rows {
				assert.Equal(t, tt.selling, row["poGrandTotal"] != nil, "list total")
			}
		})
	}
}

// Input cannot probe or cancel.
func TestHandler_POInputRefusals(t *testing.T) {
	_, tx, srv := txServer(t)
	_, poID := acceptedQuotationWithPO(t, tx)
	in := asRole(roles.OperationalInput)
	for _, q := range []string{"?minTotal=1", "?maxTotal=1", "?sortBy=total"} {
		res := doJSONWithHeaders(t, srv, http.MethodGet, "/purchase-orders/"+q, nil, in)
		p := readProblem(t, res)
		res.Body.Close()
		assert.Equal(t, http.StatusForbidden, res.StatusCode, q)
		assert.Equal(t, rolegate.RefusedDetail, p.Detail, q)
	}
	res := doJSONWithHeaders(t, srv, http.MethodPatch, fmt.Sprintf("/purchase-orders/%d/status", poID),
		purchaseorders.ChangeStatusRequest{Status: purchaseorders.StatusCancelled, Note: "batal"}, in)
	res.Body.Close()
	assert.Equal(t, http.StatusForbidden, res.StatusCode)
}

// Input edits keep harga jual.
// Its harga beli and qty are stored; harga jual, the discount and the
// shipping charge stay as stored, and it cannot add or drop a line.
func TestHandler_POInputKeepsPrices(t *testing.T) {
	ctx, tx, srv := txServer(t)
	_, poID := acceptedQuotationWithPO(t, tx)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	before, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	stored, err := repo.ListItems(ctx, poID)
	require.NoError(t, err)
	var line purchaseorders.PurchaseOrderItem
	for _, l := range stored {
		if l.ItemType == "product" {
			line = l
		}
	}
	path := fmt.Sprintf("/purchase-orders/%d/items", poID)
	edit := func(lines ...purchaseorders.UpdateItemsLine) *http.Response {
		po, err := repo.GetByID(ctx, poID)
		require.NoError(t, err)
		h := map[string]string{"If-Match": strconv.Itoa(int(po.RowVersion)), roleHeader: roles.OperationalInput}
		return doJSONWithHeaders(t, srv, http.MethodPut, path, purchaseorders.UpdateItemsRequest{
			DiscountPct: "50", ShippingCost: strPtr("1"), ShippingAddress: strPtr("Jl. Pelabuhan Raya No. 12"), Items: lines,
		}, h)
	}
	mine := purchaseorders.UpdateItemsLine{
		ID: &line.ID, QuotationItemID: line.QuotationItemID, OfferedItemID: line.OfferedItemID,
		ItemName: line.ItemName, Qty: "7", UnitID: line.UnitID, SellingPrice: "1", CostPrice: strPtr("55000"),
		VendorProductID: line.VendorProductID,
	}

	res := edit(mine)
	res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	after, err := repo.ListItems(ctx, poID)
	require.NoError(t, err)
	for _, l := range after {
		if l.ItemType == "product" {
			assert.Equal(t, line.SellingPrice, l.SellingPrice, "harga jual stays")
			assert.Equal(t, "7.00", l.Qty)
			require.NotNil(t, l.CostPrice)
			assert.Equal(t, "55000.00", *l.CostPrice)
		}
	}
	po, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	assert.Equal(t, before.DiscountPct, po.DiscountPct)

	extra := mine
	extra.ID = nil
	for _, lines := range [][]purchaseorders.UpdateItemsLine{{mine, extra}, {}, {extra}} {
		res := edit(lines...)
		p := readProblem(t, res)
		res.Body.Close()
		assert.Equal(t, http.StatusForbidden, res.StatusCode)
		assert.Contains(t, p.Detail, "kepala operasional")
	}
}
