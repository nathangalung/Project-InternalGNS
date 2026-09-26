package invoices_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// listFixture holds three invoices.
type listFixture struct {
	pastDueDraft, sent, paid invoices.Invoice
}

// seedListFixture builds on empty domain.
// The truncate runs inside tx, so the rollback restores every other row.
func seedListFixture(t *testing.T, ctx context.Context, tx pgx.Tx) listFixture {
	t.Helper()
	require.NoError(t, testutil.ResetCommercialDomain(ctx, tx))
	repo := invoices.NewRepo(tx, testutil.Store(t))

	invoiceOf := func(qty string, invDate, dueDate string, path ...invoices.Status) invoices.Invoice {
		_, _, id := deliverQuotation(t, tx, quotations.CreateRequest{
			CompanyClientID: seedCompanyID,
			DiscountPct:     "0",
			Items: []quotations.CreateItem{{
				RequestedName: "List Filter Product", Qty: qty, UnitID: seedUnitID, SellingPrice: "100000",
			}},
		})
		inv := mustDate(t, invDate)
		due := mustDate(t, dueDate)
		_, err := repo.UpdateDates(ctx, id, invoices.UpdateDatesRequest{InvoiceDate: &inv, DueDate: &due}, seedUserID, nil)
		require.NoError(t, err)
		for _, s := range path {
			require.NoError(t, repo.ChangeStatus(ctx, id, move(s), seedUserID))
		}
		got, err := repo.GetByID(ctx, id)
		require.NoError(t, err)
		return got
	}
	return listFixture{
		pastDueDraft: invoiceOf("1", "2026-01-05", "2026-02-04"),
		sent:         invoiceOf("2", "2099-03-01", "2099-03-31", invoices.StatusSent),
		paid:         invoiceOf("3", "2099-06-01", "2099-07-01", invoices.StatusSent, invoices.StatusPaid),
	}
}

func mustDate(t *testing.T, s string) time.Time {
	t.Helper()
	d, err := time.Parse(time.DateOnly, s)
	require.NoError(t, err)
	return d
}

// List applies every screen filter.
func TestHandler_List_Filters(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	fx := seedListFixture(t, ctx, tx)
	h := invoices.NewHandler(invoices.NewRepo(tx, testutil.Store(t)), nil)
	a, b, c := fx.pastDueDraft.ID, fx.sent.ID, fx.paid.ID

	cases := []struct {
		name  string
		query string
		want  []int64
		total int
	}{
		{name: "no filter, newest first", query: "", want: []int64{c, b, a}},
		{name: "stored status", query: "status=draft", want: []int64{a}},
		{name: "several stored statuses, blanks ignored", query: "status=sent,%20,paid", want: []int64{c, b}},
		{name: "effective Terlambat is the past-due draft", query: "effectiveStatus=%20overdue,%20", want: []int64{a}},
		{name: "effective draft leaves out the past-due draft", query: "effectiveStatus=draft", want: []int64{}},
		{name: "unknown effective values are ignored", query: "effectiveStatus=cancelled,bogus", want: []int64{c, b, a}},
		{name: "invoice date from", query: "dateFrom=2099-01-01", want: []int64{c, b}},
		{name: "invoice date to", query: "dateTo=2026-12-31", want: []int64{a}},
		{name: "due date window", query: "dueFrom=2099-03-31&dueTo=2099-03-31", want: []int64{b}},
		{name: "minimum total", query: "minTotal=200000", want: []int64{c, b}},
		{name: "maximum total", query: "maxTotal=250000", want: []int64{b, a}},
		{name: "total band", query: "minTotal=200000&maxTotal=250000", want: []int64{b}},
		{name: "search by quotation number", query: "q=" + url.QueryEscape(fx.sent.QuotationNo), want: []int64{b}},
		{name: "search by invoice number", query: "q=" + url.QueryEscape(fx.paid.InvoiceNo), want: []int64{c}},
		{name: "sort by total ascending", query: "sortBy=total&sortDir=asc", want: []int64{a, b, c}},
		{name: "second page of one", query: "sortBy=total&sortDir=asc&limit=1&offset=1", want: []int64{b}, total: 3},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.List(rec, httptest.NewRequest(http.MethodGet, "/invoices/?"+tc.query, nil))
			require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

			var rows []invoices.Invoice
			require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &rows))
			got := make([]int64, 0, len(rows))
			for _, r := range rows {
				got = append(got, r.ID)
			}
			assert.Equal(t, tc.want, got)
			total := tc.total
			if total == 0 {
				total = len(tc.want)
			}
			assert.Equal(t, strconv.Itoa(total), rec.Header().Get("X-Total-Count"))
		})
	}
}

// XLSX export uses list filter.
func TestHandler_Export_AppliesFilter(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	fx := seedListFixture(t, ctx, tx)
	h := invoices.NewHandler(invoices.NewRepo(tx, testutil.Store(t)), nil)

	rec := httptest.NewRecorder()
	h.Export(rec, httptest.NewRequest(http.MethodGet, "/invoices/export.xlsx?dateFrom=2099-01-01&sortBy=total&sortDir=asc", nil))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	f, err := excelize.OpenReader(bytes.NewReader(rec.Body.Bytes()))
	require.NoError(t, err)
	defer func() { _ = f.Close() }()
	rows, err := f.GetRows(f.GetSheetName(0))
	require.NoError(t, err)
	require.Len(t, rows, 3, "header plus the two 2099 invoices")

	for i, inv := range []invoices.Invoice{fx.sent, fx.paid} {
		row := rows[i+1]
		assert.Equal(t, inv.InvoiceNo, row[0])
		assert.Equal(t, inv.QuotationNo, row[1])
		assert.Equal(t, inv.InvoiceDate.Format(time.DateOnly), row[2])
		assert.Equal(t, inv.DueDate.Format(time.DateOnly), row[3])
		assert.Equal(t, inv.CompanyName, row[4])
		assert.Equal(t, *inv.Total, row[6])
	}
}
