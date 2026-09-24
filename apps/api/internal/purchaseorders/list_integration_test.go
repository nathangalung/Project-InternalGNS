package purchaseorders_test

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// listFixture holds two client POs.
// Both belong to one fresh client.
// A was quoted low and edited high, B was quoted in between and left
// alone, so ordering by the quotation total and by the PO's own total
// disagree. That is what tells the two total sources apart (PO-06).
type listFixture struct {
	client string
	a, b   purchaseorders.PurchaseOrder
}

func newListFixture(t *testing.T, tx pgx.Tx) listFixture {
	t.Helper()
	ctx := context.Background()
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	token := fmt.Sprintf("%d", time.Now().UnixNano())
	clientID, client := probeClient(t, tx, "Klien Daftar PO "+token)

	quoted := func(price string) int64 {
		_, poID := createQuotation(t, tx, quotations.CreateRequest{
			CompanyClientID: clientID,
			DiscountPct:     "0",
			Items: []quotations.CreateItem{{
				RequestedName: "Barang Daftar", Qty: "2", UnitID: seedUnitID, SellingPrice: price,
			}},
		})
		return poID
	}
	aID, bID := quoted("100000"), quoted("150000")

	_, err := repo.UpdateItems(ctx, aID, itemsAt("250000"), seedUserID, nil)
	require.NoError(t, err)
	require.NoError(t, repo.UpdateDetails(ctx, aID, token+"-A",
		time.Date(2026, time.January, 10, 0, 0, 0, 0, time.UTC), seedUserID, nil))
	require.NoError(t, repo.UpdateDetails(ctx, bID, token+"-B",
		time.Date(2026, time.February, 20, 0, 0, 0, 0, time.UTC), seedUserID, nil))
	reachStatus(t, tx, bID, purchaseorders.StatusUploaded)

	a, err := repo.GetByID(ctx, aID)
	require.NoError(t, err)
	b, err := repo.GetByID(ctx, bID)
	require.NoError(t, err)
	// The premise of the fixture, checked rather than assumed.
	require.Equal(t, "555000.00", a.PoGrandTotal)
	require.Equal(t, "333000.00", b.PoGrandTotal)
	require.Less(t, mustFloat(t, *a.QuotationTotal), mustFloat(t, *b.QuotationTotal))
	return listFixture{client: client, a: a, b: b}
}

// probeClient inserts a fresh client.
// It takes the first free four-digit number.
func probeClient(t *testing.T, tx pgx.Tx, name string) (int64, string) {
	t.Helper()
	var id int64
	require.NoError(t, tx.QueryRow(context.Background(), `
		INSERT INTO company_client (number, name, country_code, created_by, updated_by)
		SELECT lpad(n::text, 4, '0'), $1, 'IDN', $2, $2
		FROM generate_series(1000, 9999) n
		WHERE NOT EXISTS (SELECT 1 FROM company_client WHERE number = lpad(n::text, 4, '0'))
		LIMIT 1
		RETURNING id`, name, seedUserID).Scan(&id))
	return id, name
}

// itemsAt prices one product line.
// The line is qty 2 at price.
func itemsAt(price string) purchaseorders.UpdateItemsRequest {
	return purchaseorders.UpdateItemsRequest{
		DiscountPct: "0",
		Items: []purchaseorders.UpdateItemsLine{{
			ItemName: "Barang Daftar", Qty: "2", UnitID: int16Ptr(seedUnitID), SellingPrice: price,
		}},
	}
}

func mustFloat(t *testing.T, s string) float64 {
	t.Helper()
	var f float64
	_, err := fmt.Sscan(s, &f)
	require.NoError(t, err)
	return f
}

func ids(rows []purchaseorders.PurchaseOrder) []int64 {
	out := make([]int64, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.ID)
	}
	return out
}

// Every list filter narrows results.
// Totals follow the PO's own total.
func TestRepo_List_Filters(t *testing.T) {
	day := func(m time.Month, d int) *time.Time {
		v := time.Date(2026, m, d, 0, 0, 0, 0, time.UTC)
		return &v
	}
	amount := func(s string) *string { return &s }
	tests := []struct {
		name  string
		build func(fx listFixture) purchaseorders.ListFilter
		want  func(fx listFixture) []int64
	}{
		{
			"client name matches both",
			func(fx listFixture) purchaseorders.ListFilter { return purchaseorders.ListFilter{Q: fx.client} },
			func(fx listFixture) []int64 { return []int64{fx.b.ID, fx.a.ID} },
		},
		{
			"po number matches one",
			func(fx listFixture) purchaseorders.ListFilter { return purchaseorders.ListFilter{Q: fx.a.PoNumber} },
			func(fx listFixture) []int64 { return []int64{fx.a.ID} },
		},
		{
			"quotation number matches one",
			func(fx listFixture) purchaseorders.ListFilter { return purchaseorders.ListFilter{Q: fx.b.QuotationNo} },
			func(fx listFixture) []int64 { return []int64{fx.b.ID} },
		},
		{
			"one status",
			func(fx listFixture) purchaseorders.ListFilter {
				return purchaseorders.ListFilter{Q: fx.client, Statuses: []string{"UPLOADED"}}
			},
			func(fx listFixture) []int64 { return []int64{fx.b.ID} },
		},
		{
			"several statuses",
			func(fx listFixture) purchaseorders.ListFilter {
				return purchaseorders.ListFilter{Q: fx.client, Statuses: []string{"PENDING", "UPLOADED"}}
			},
			func(fx listFixture) []int64 { return []int64{fx.b.ID, fx.a.ID} },
		},
		{
			"date from",
			func(fx listFixture) purchaseorders.ListFilter {
				return purchaseorders.ListFilter{Q: fx.client, DateFrom: day(time.February, 1)}
			},
			func(fx listFixture) []int64 { return []int64{fx.b.ID} },
		},
		{
			"date to is inclusive",
			func(fx listFixture) purchaseorders.ListFilter {
				return purchaseorders.ListFilter{Q: fx.client, DateTo: day(time.January, 10)}
			},
			func(fx listFixture) []int64 { return []int64{fx.a.ID} },
		},
		{
			"min total uses the PO total (PO-06)",
			func(fx listFixture) purchaseorders.ListFilter {
				return purchaseorders.ListFilter{Q: fx.client, MinTotal: amount("400000")}
			},
			func(fx listFixture) []int64 { return []int64{fx.a.ID} },
		},
		{
			"max total uses the PO total (PO-06)",
			func(fx listFixture) purchaseorders.ListFilter {
				return purchaseorders.ListFilter{Q: fx.client, MaxTotal: amount("400000")}
			},
			func(fx listFixture) []int64 { return []int64{fx.b.ID} },
		},
		{
			"total bounds are inclusive",
			func(fx listFixture) purchaseorders.ListFilter {
				return purchaseorders.ListFilter{Q: fx.client, MinTotal: amount("333000"), MaxTotal: amount("333000")}
			},
			func(fx listFixture) []int64 { return []int64{fx.b.ID} },
		},
		{
			"sort by total descending uses the PO total (PO-06)",
			func(fx listFixture) purchaseorders.ListFilter {
				return purchaseorders.ListFilter{Q: fx.client, SortBy: "total", SortDir: "desc"}
			},
			func(fx listFixture) []int64 { return []int64{fx.a.ID, fx.b.ID} },
		},
		{
			"sort by total ascending uses the PO total (PO-06)",
			func(fx listFixture) purchaseorders.ListFilter {
				return purchaseorders.ListFilter{Q: fx.client, SortBy: "total", SortDir: "asc"}
			},
			func(fx listFixture) []int64 { return []int64{fx.b.ID, fx.a.ID} },
		},
		{
			"sort by po number ascending",
			func(fx listFixture) purchaseorders.ListFilter {
				return purchaseorders.ListFilter{Q: fx.client, SortBy: "poNumber", SortDir: "asc"}
			},
			func(fx listFixture) []int64 { return []int64{fx.a.ID, fx.b.ID} },
		},
		{
			"no match is an empty slice",
			func(fx listFixture) purchaseorders.ListFilter {
				return purchaseorders.ListFilter{Q: fx.client, Statuses: []string{"DELIVERED"}}
			},
			func(listFixture) []int64 { return []int64{} },
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			fx := newListFixture(t, tx)
			f := tc.build(fx)
			f.Limit = 50
			res, err := purchaseorders.NewRepo(tx, testutil.Store(t)).List(ctx, f)
			require.NoError(t, err)
			want := tc.want(fx)
			require.NotNil(t, res.Rows)
			assert.Equal(t, want, ids(res.Rows))
			assert.Equal(t, int64(len(want)), res.Total)
		})
	}
}

// A page keeps the count.
func TestRepo_List_PageKeepsTotal(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	fx := newListFixture(t, tx)
	res, err := purchaseorders.NewRepo(tx, testutil.Store(t)).List(ctx, purchaseorders.ListFilter{
		Q: fx.client, SortBy: "poNumber", SortDir: "asc", Limit: 1, Offset: 1,
	})
	require.NoError(t, err)
	assert.Equal(t, []int64{fx.b.ID}, ids(res.Rows))
	assert.Equal(t, int64(2), res.Total)
}

// Query parameters reach the filter.
func TestHandler_List_ParsesFilters(t *testing.T) {
	_, tx, srv := txServer(t)
	fx := newListFixture(t, tx)

	q := url.Values{}
	q.Set("q", "  "+fx.client+"  ")
	q.Set("status", " PENDING , ,UPLOADED ")
	q.Set("dateFrom", "2026-01-01")
	q.Set("dateTo", "2026-12-31")
	q.Set("minTotal", " 400000 ")
	q.Set("maxTotal", "600000")
	res := doJSON(t, srv, http.MethodGet, "/purchase-orders/?"+q.Encode(), nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	assert.Equal(t, "1", res.Header.Get("X-Total-Count"))

	var rows []purchaseorders.PurchaseOrder
	readJSON(t, res, &rows)
	require.Len(t, rows, 1)
	assert.Equal(t, fx.a.ID, rows[0].ID)
	assert.Equal(t, "555000.00", rows[0].PoGrandTotal)
}

// Export matches the list (PO-06).
func TestHandler_Export_MatchesList(t *testing.T) {
	_, tx, srv := txServer(t)
	fx := newListFixture(t, tx)

	rows := exportRows(t, srv, url.Values{"q": {fx.client}, "sortBy": {"poNumber"}, "sortDir": {"asc"}})
	require.Len(t, rows, 3)
	assert.Equal(t, []string{"No. Delivery Note", "No. PO", "No. Quotation", "Tanggal", "Klien", "Status", "Total"}, rows[0])
	assert.Equal(t, []string{"", fx.a.PoNumber, fx.a.QuotationNo, "2026-01-10", fx.client, "Pending", "555000.00"}, rows[1])
	assert.Equal(t, []string{"", fx.b.PoNumber, fx.b.QuotationNo, "2026-02-20", fx.client, "PO Diunggah", "333000.00"}, rows[2])
}

// exportRows reads the XLSX sheet.
func exportRows(t *testing.T, srv *httptest.Server, q url.Values) [][]string {
	t.Helper()
	res := doJSON(t, srv, http.MethodGet, "/purchase-orders/export.xlsx?"+q.Encode(), nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	body, err := io.ReadAll(res.Body)
	require.NoError(t, err)
	f, err := excelize.OpenReader(bytes.NewReader(body))
	require.NoError(t, err)
	rows, err := f.GetRows("Delivery Note")
	require.NoError(t, err)
	return rows
}

// Register follows the PDF (PO-14).
// The export prints a note number only where the PDF would.
// A PO walked back from ON_PROGRESS keeps its stored number, but its
// delivery note is refused, so the register must not list it either.
func TestHandler_Export_DeliveryNoteFollowsIssuance(t *testing.T) {
	tests := []struct {
		name   string
		walk   func(t *testing.T, tx pgx.Tx, poID int64)
		status string
		listed bool
	}{
		{"on progress lists it", func(*testing.T, pgx.Tx, int64) {}, "Dalam Progres", true},
		{"back to uploaded hides it", func(t *testing.T, tx pgx.Tx, poID int64) {
			require.NoError(t, purchaseorders.NewRepo(tx, testutil.Store(t)).
				ChangeStatus(context.Background(), poID, purchaseorders.StatusUploaded, seedUserID))
		}, "PO Diunggah", false},
		{"back to pending hides it", func(t *testing.T, tx pgx.Tx, poID int64) {
			repo := purchaseorders.NewRepo(tx, testutil.Store(t))
			require.NoError(t, repo.ChangeStatus(context.Background(), poID, purchaseorders.StatusUploaded, seedUserID))
			require.NoError(t, repo.RemoveFile(context.Background(), poID, seedUserID))
		}, "Pending", false},
		{"cancelled hides it", func(t *testing.T, tx pgx.Tx, poID int64) {
			require.NoError(t, purchaseorders.NewRepo(tx, testutil.Store(t)).
				Transition(context.Background(), poID, purchaseorders.StatusCancelled, "Batal", seedUserID))
		}, "Dibatalkan", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx, srv := txServer(t)
			_, poID := poAt(t, tx, purchaseorders.StatusOnProgress)
			tc.walk(t, tx, poID)
			po, err := purchaseorders.NewRepo(tx, testutil.Store(t)).GetByID(ctx, poID)
			require.NoError(t, err)
			require.NotNil(t, po.DeliveryNoteNumber, "the stored number survives the walk")

			rows := exportRows(t, srv, url.Values{"q": {po.PoNumber}})
			require.Len(t, rows, 2)
			assert.Equal(t, tc.status, rows[1][5])
			want := ""
			if tc.listed {
				want = *po.DeliveryNoteNumber
			}
			assert.Equal(t, want, rows[1][0])
		})
	}
}
