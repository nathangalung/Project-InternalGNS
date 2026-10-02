package quotations_test

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/live"
)

// Field messages for numeric input.
const (
	qtyMsg       = "Jumlah harus berupa angka lebih dari 0."
	sellMsg      = "Harga jual harus berupa angka 0 atau lebih."
	costMsg      = "Harga beli harus berupa angka 0 atau lebih."
	shipCostMsg  = "Biaya pengiriman harus berupa angka 0 atau lebih."
	validityMsg  = "Masa berlaku harus antara 1 dan 365 hari."
	shipDaysMsg  = "Waktu pengiriman harus antara 1 dan 365 hari."
	lineQtyField = "items[0].qty"
)

// lineCase spoils one line field.
type lineCase struct {
	name  string
	spoil func(*quotations.CreateItem)
	field string
	msg   string
}

var lineCases = []lineCase{
	{"qty NaN", func(it *quotations.CreateItem) { it.Qty = "NaN" }, lineQtyField, qtyMsg},
	{"qty Inf", func(it *quotations.CreateItem) { it.Qty = "Inf" }, lineQtyField, qtyMsg},
	{"qty negative", func(it *quotations.CreateItem) { it.Qty = "-1" }, lineQtyField, qtyMsg},
	{"qty zero", func(it *quotations.CreateItem) { it.Qty = "0" }, lineQtyField, qtyMsg},
	{"selling NaN", func(it *quotations.CreateItem) { it.SellingPrice = "NaN" }, "items[0].sellingPrice", sellMsg},
	{"selling Inf", func(it *quotations.CreateItem) { it.SellingPrice = "Infinity" }, "items[0].sellingPrice", sellMsg},
	{"selling negative", func(it *quotations.CreateItem) { it.SellingPrice = "-1" }, "items[0].sellingPrice", sellMsg},
	{"selling blank", func(it *quotations.CreateItem) { it.SellingPrice = "" }, "items[0].sellingPrice", sellMsg},
	{"cost NaN", func(it *quotations.CreateItem) { it.CostPrice = strPtr("NaN") }, "items[0].costPrice", costMsg},
	{"cost Inf", func(it *quotations.CreateItem) { it.CostPrice = strPtr("-Inf") }, "items[0].costPrice", costMsg},
	{"cost negative", func(it *quotations.CreateItem) { it.CostPrice = strPtr("-900000") }, "items[0].costPrice", costMsg},
}

// termsCase spoils one header number.
type termsCase struct {
	name     string
	validity *int
	shipDays *int
	shipCost *string
	field    string
	msg      string
}

func intPtr(n int) *int { return &n }

var termsCases = []termsCase{
	{"validity zero", intPtr(0), nil, nil, "validityDays", validityMsg},
	{"validity negative", intPtr(-30), nil, nil, "validityDays", validityMsg},
	{"validity too long", intPtr(366), nil, nil, "validityDays", validityMsg},
	{"shipping days zero", nil, intPtr(0), nil, "shippingDays", shipDaysMsg},
	{"shipping days negative", nil, intPtr(-1), nil, "shippingDays", shipDaysMsg},
	{"shipping cost NaN", nil, nil, strPtr("NaN"), "shippingCost", shipCostMsg},
	{"shipping cost negative", nil, nil, strPtr("-1"), "shippingCost", shipCostMsg},
	{"shipping cost blank", nil, nil, strPtr(""), "shippingCost", shipCostMsg},
}

// assertField checks one 422 field.
func assertField(t *testing.T, res *http.Response, field, msg string) {
	t.Helper()
	e := problemOf(t, res)
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
	assert.Equal(t, msg, e.Fields[field], "fields=%v", e.Fields)
}

// Line numbers refuse NaN, infinities and negatives.
// Every write path is checked before the database, which sorts NaN above
// every number and so lets it through a >= 0 CHECK.
func TestHandler_LineNumbersRefused(t *testing.T) {
	srv := liveServer(t, live.NewHub())
	id, lines := liveDraftOver(t, srv)
	base := "/quotations/" + strconv.FormatInt(id, 10)
	line := base + "/lines/" + strconv.FormatInt(lines[0], 10)
	ifMatch := map[string]string{"If-Match": "0"}

	for _, c := range lineCases {
		item := offered()
		c.spoil(&item)
		t.Run(c.name+"/create", func(t *testing.T) {
			req := sampleCreate()
			req.Items = []quotations.CreateItem{item}
			assertField(t, doJSON(t, srv, http.MethodPost, "/quotations/", req), c.field, c.msg)
		})
		t.Run(c.name+"/update", func(t *testing.T) {
			res := doJSONWithHeaders(t, srv, http.MethodPut, base,
				quotations.UpdateRequest{DiscountPct: "0", Items: []quotations.CreateItem{item}}, ifMatch)
			assertField(t, res, c.field, c.msg)
		})
		t.Run(c.name+"/add lines", func(t *testing.T) {
			res := doJSON(t, srv, http.MethodPost, base+"/lines",
				quotations.AddLinesRequest{Items: []quotations.CreateItem{item}})
			assertField(t, res, c.field, c.msg)
		})
		t.Run(c.name+"/update line", func(t *testing.T) {
			assertField(t, doJSON(t, srv, http.MethodPut, line, item), c.field, c.msg)
		})
	}
}

// Header numbers stay in range.
// A negative validity would let the hourly job expire a sent quotation at once.
func TestHandler_TermNumbersRefused(t *testing.T) {
	srv := liveServer(t, live.NewHub())
	id, _ := liveDraftOver(t, srv)
	base := "/quotations/" + strconv.FormatInt(id, 10)
	ifMatch := map[string]string{"If-Match": "0"}

	for _, c := range termsCases {
		t.Run(c.name+"/create", func(t *testing.T) {
			req := sampleCreate()
			req.ValidityDays, req.ShippingDays, req.ShippingCost = c.validity, c.shipDays, c.shipCost
			assertField(t, doJSON(t, srv, http.MethodPost, "/quotations/", req), c.field, c.msg)
		})
		t.Run(c.name+"/update", func(t *testing.T) {
			req := quotations.UpdateRequest{
				DiscountPct: "0", Items: []quotations.CreateItem{offered()},
				ValidityDays: c.validity, ShippingDays: c.shipDays, ShippingCost: c.shipCost,
			}
			assertField(t, doJSONWithHeaders(t, srv, http.MethodPut, base, req, ifMatch), c.field, c.msg)
		})
		t.Run(c.name+"/header", func(t *testing.T) {
			req := quotations.HeaderRequest{
				DiscountPct: "0", ValidityDays: c.validity, ShippingDays: c.shipDays, ShippingCost: c.shipCost,
			}
			assertField(t, doJSON(t, srv, http.MethodPut, base+"/header", req), c.field, c.msg)
		})
	}
}

// A blank cost price stays allowed.
// A draft may keep a line without harga beli; the send rule asks for it.
func TestHandler_BlankCostPriceAllowed(t *testing.T) {
	srv := liveServer(t, live.NewHub())
	id, _ := liveDraftOver(t, srv)
	item := offered()
	item.CostPrice = strPtr("")
	res := doJSON(t, srv, http.MethodPost, "/quotations/"+strconv.FormatInt(id, 10)+"/lines",
		quotations.AddLinesRequest{Items: []quotations.CreateItem{item}})
	res.Body.Close()
	assert.Equal(t, http.StatusCreated, res.StatusCode)
}
