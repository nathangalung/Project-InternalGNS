package quotations_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/live"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/rolegate"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/roles"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// asRole acts as seed user in role.
func asRole(role string) map[string]string {
	return map[string]string{roleHeader: role}
}

// getMap decodes a body by key.
// A struct decode cannot tell an absent key from an empty one.
func getMap(t *testing.T, res *http.Response) map[string]any {
	t.Helper()
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var m map[string]any
	require.NoError(t, json.NewDecoder(res.Body).Decode(&m))
	return m
}

// Operational input sees no selling figure.
// Harga beli stays, every selling figure and the moves go; the finance head
// sees every figure but no move.
func TestHandler_DetailByRole(t *testing.T) {
	srv := liveServer(t, live.NewHub())
	id, _ := liveDraftOver(t, srv)
	path := "/quotations/" + strconv.FormatInt(id, 10)

	selling := []string{"discountPct", "totalProduk", "total", "totalDiscount", "subtotal", "dppNilaiLain", "ppnAmount", "grandTotal"}
	lineSelling := []string{"sellingPrice", "discountPct", "totalSelling", "discountAmount", "subtotal"}

	in := getMap(t, doJSONWithHeaders(t, srv, http.MethodGet, path, nil, asRole(roles.OperationalInput)))
	for _, k := range selling {
		assert.NotContains(t, in, k)
	}
	for _, raw := range in["items"].([]any) {
		line := raw.(map[string]any)
		for _, k := range lineSelling {
			assert.NotContains(t, line, k, "line %v", line["id"])
		}
		if line["itemType"] == "product" {
			assert.Contains(t, line, "costPrice")
		}
	}
	assert.Empty(t, in["allowedTransitions"])
	assert.Equal(t, false, in["canRevise"])

	head := getMap(t, doJSONWithHeaders(t, srv, http.MethodGet, path, nil, asRole(roles.Finance)))
	for _, k := range selling {
		assert.Contains(t, head, k)
	}
	assert.Empty(t, head["allowedTransitions"], "the finance head only reads")

	admin := getMap(t, doJSONWithHeaders(t, srv, http.MethodGet, path, nil, asRole(roles.Superadmin)))
	assert.NotEmpty(t, admin["allowedTransitions"])
}

// The list hides totals and refuses probes.
func TestHandler_ListByRole(t *testing.T) {
	srv := liveServer(t, live.NewHub())
	liveDraftOver(t, srv)

	res := doJSONWithHeaders(t, srv, http.MethodGet, "/quotations/", nil, asRole(roles.OperationalInput))
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var rows []map[string]any
	require.NoError(t, json.NewDecoder(res.Body).Decode(&rows))
	require.NotEmpty(t, rows)
	for _, row := range rows {
		assert.NotContains(t, row, "grandTotal")
		assert.NotContains(t, row, "subtotal")
		assert.NotContains(t, row, "totalDiscount")
		assert.Contains(t, row, "totalHargaBeli")
	}

	for _, q := range []string{"?minTotal=1", "?maxTotal=1", "?sortBy=grandTotal", "?sortBy=total"} {
		res := doJSONWithHeaders(t, srv, http.MethodGet, "/quotations/"+q, nil, asRole(roles.OperationalInput))
		p := problemOf(t, res)
		assert.Equal(t, http.StatusForbidden, p.Status, q)
		assert.Equal(t, rolegate.RefusedDetail, p.Detail, q)
	}
	res = doJSONWithHeaders(t, srv, http.MethodGet, "/quotations/?sortBy=createdAt", nil, asRole(roles.OperationalInput))
	res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

// Operational input keeps stored prices.
// Its line and header saves carry prices, and none is stored; its new lines
// and new quotations start at harga jual 0 and no discount.
func TestHandler_InputKeepsPrices(t *testing.T) {
	srv := liveServer(t, live.NewHub())
	id, lines := liveDraftOver(t, srv)
	base := "/quotations/" + strconv.FormatInt(id, 10)
	in := asRole(roles.OperationalInput)

	res := doJSONWithHeaders(t, srv, http.MethodPost, base+"/locks", quotations.LockRequest{Part: quotations.LinePart(lines[0])}, in)
	res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	edited := offered()
	edited.Qty, edited.SellingPrice, edited.CostPrice = "5", "1", strPtr("900000")
	res = doJSONWithHeaders(t, srv, http.MethodPut, base+"/lines/"+strconv.FormatInt(lines[0], 10), edited, in)
	res.Body.Close()
	require.Equal(t, http.StatusNoContent, res.StatusCode)

	res = doJSONWithHeaders(t, srv, http.MethodPost, base+"/locks", quotations.LockRequest{Part: quotations.HeaderPart}, in)
	res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	addr, days, cost := "Tanjung Priok", 4, "1"
	res = doJSONWithHeaders(t, srv, http.MethodPut, base+"/header",
		quotations.HeaderRequest{DiscountPct: "50", ShippingAddress: &addr, ShippingDays: &days, ShippingCost: &cost}, in)
	res.Body.Close()
	require.Equal(t, http.StatusNoContent, res.StatusCode)

	res = doJSONWithHeaders(t, srv, http.MethodPost, base+"/lines", quotations.AddLinesRequest{Items: []quotations.CreateItem{offered()}}, in)
	require.Equal(t, http.StatusCreated, res.StatusCode)
	var added quotations.AddLinesResponse
	require.NoError(t, json.NewDecoder(res.Body).Decode(&added))
	res.Body.Close()

	res = doJSON(t, srv, http.MethodGet, base, nil)
	var d quotations.QuotationDetail
	require.NoError(t, json.NewDecoder(res.Body).Decode(&d))
	res.Body.Close()
	assert.Equal(t, "10.00", d.DiscountPct, "the stored discount")
	for _, it := range d.Items {
		switch {
		case it.ID == lines[0]:
			assert.Equal(t, "1500000.00", it.SellingPrice)
			assert.Equal(t, "5.00", it.Qty)
			require.NotNil(t, it.CostPrice)
			assert.Equal(t, "900000.00", *it.CostPrice, "harga beli is theirs to set")
		case it.ID == added.IDs[0]:
			assert.Equal(t, "0.00", it.SellingPrice, "a new line waits for a head")
		case it.ItemType == "shipping":
			assert.Equal(t, "150000.00", it.SellingPrice, "the stored shipping charge")
			assert.Equal(t, 4, *it.ShippingDays)
		}
	}

	req := sampleCreate()
	req.Items = []quotations.CreateItem{offered()}
	res = doJSONWithHeaders(t, srv, http.MethodPost, "/quotations/", req, in)
	require.Equal(t, http.StatusCreated, res.StatusCode)
	var created map[string]int64
	require.NoError(t, json.NewDecoder(res.Body).Decode(&created))
	res.Body.Close()
	res = doJSON(t, srv, http.MethodGet, "/quotations/"+strconv.FormatInt(created["id"], 10), nil)
	var fresh quotations.QuotationDetail
	require.NoError(t, json.NewDecoder(res.Body).Decode(&fresh))
	res.Body.Close()
	assert.Equal(t, "0.00", fresh.DiscountPct)
	for _, it := range fresh.Items {
		assert.Equal(t, "0.00", it.SellingPrice, "%s line", it.ItemType)
	}
}

// Operational input downloads no quotation.
// The gate refuses before rendering, so no xelatex is needed.
func TestRoutes_PDFRefusedToInput(t *testing.T) {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			next.ServeHTTP(w, req.WithContext(deps.WithUserRole(req.Context(), roles.OperationalInput)))
		})
	})
	r.Mount("/quotations", quotations.Routes(deps.Deps{Pool: testutil.Pool(t), Queries: testutil.Store(t), TemplatesRoot: t.TempDir()}))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	res := doJSON(t, srv, http.MethodGet, "/quotations/1/pdf", nil)
	p := problemOf(t, res)
	assert.Equal(t, http.StatusForbidden, p.Status)
	assert.Equal(t, rolegate.RefusedDetail, p.Detail)
}
