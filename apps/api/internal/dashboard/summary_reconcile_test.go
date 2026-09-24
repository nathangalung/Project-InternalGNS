package dashboard_test

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/dashboard"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// paidInvoiceFixture inserts a quotation, PO and paid invoice.
// Figures follow fn_create_invoice: total = dpp + ppn_amount, so the PPN share
// of revenue is visible and the DPP base is not.
func paidInvoiceFixture(t *testing.T, ctx context.Context, tx pgx.Tx, invoiceDate time.Time) {
	t.Helper()
	var quotationID int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO quotations (quotation_no, company_client_id, company_client_name,
		                        discount_pct, total_produk, total, total_discount,
		                        created_by, updated_by)
		VALUES ('SQ-RECON-1', 1, 'PT. IMC Ship Management', 0, 10000, 10000, 0, 1, 1)
		RETURNING id`).Scan(&quotationID))

	var poID int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO purchase_orders (po_number, quotation_id, company_client_id, po_date,
		                             discount_pct, status, created_by, updated_by)
		VALUES ('PO-RECON-1', $1, 1, $2, 0, 'DELIVERED', 1, 1)
		RETURNING id`, quotationID, invoiceDate).Scan(&poID))

	_, err := tx.Exec(ctx, `
		INSERT INTO purchase_order_items (po_id, line_number, item_type, qty, unit_id,
		                                  selling_price, cost_price, discount_pct,
		                                  item_name, created_by, updated_by)
		VALUES ($1, 1, 'product', 1, 19, 10000, 4000, 0, 'Recon Product', 1, 1)`, poID)
	require.NoError(t, err)

	_, err = tx.Exec(ctx, `
		INSERT INTO invoices (invoice_no, quotation_id, po_id, company_client_id,
		                      invoice_date, due_date, subtotal, dpp, dpp_nilai_lain,
		                      ppn_amount, total, status, created_by, updated_by)
		VALUES ('INV-RECON-1', $1, $2, 1, $3::date, $3::date + 30, 10000, 10000, 9166.67,
		        1100.00, 11100.00, 'paid', 1, 1)`, quotationID, poID, invoiceDate)
	require.NoError(t, err)
}

// scalar reads one numeric aggregate as a decimal.
func scalar(t *testing.T, ctx context.Context, tx pgx.Tx, sql string, args ...any) decimal.Decimal {
	t.Helper()
	var raw string
	require.NoError(t, tx.QueryRow(ctx, sql, args...).Scan(&raw))
	d, err := decimal.NewFromString(raw)
	require.NoError(t, err)
	return d
}

func mustDecimal(t *testing.T, s string) decimal.Decimal {
	t.Helper()
	d, err := decimal.NewFromString(s)
	require.NoError(t, err)
	return d
}

// Revenue and profit are DPP-based, so PPN is never booked as income.
func TestRepo_Summary_ReconcilesWithRawSums(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	paidInvoiceFixture(t, ctx, tx, time.Now())

	s, err := dashboard.NewRepo(tx, testutil.Store(t)).Summary(ctx)
	require.NoError(t, err)

	wantRevenue := scalar(t, ctx, tx,
		`SELECT COALESCE(SUM(dpp), 0)::text FROM invoices WHERE status = 'paid'`)
	wantPpn := scalar(t, ctx, tx,
		`SELECT COALESCE(SUM(ppn_amount), 0)::text FROM invoices WHERE status = 'paid'`)

	gotRevenue := mustDecimal(t, s.TotalRevenue)
	gotExpenses := mustDecimal(t, s.TotalExpenses)
	gotProfit := mustDecimal(t, s.TotalProfit)
	gotPpn := mustDecimal(t, s.TotalPpn)

	require.True(t, wantRevenue.Equal(gotRevenue),
		"revenue must be the paid DPP sum: want %s got %s", wantRevenue, gotRevenue)
	require.True(t, wantPpn.Equal(gotPpn),
		"ppn must be the paid PPN sum: want %s got %s", wantPpn, gotPpn)
	require.True(t, gotRevenue.Sub(gotExpenses).Equal(gotProfit),
		"profit must be revenue minus expenses: %s - %s != %s", gotRevenue, gotExpenses, gotProfit)
	require.True(t, gotPpn.IsPositive(), "fixture must carry PPN, got %s", gotPpn)
}

// Revenue and profit buckets exclude PPN as well.
func TestRepo_Timeseries_RevenueAndProfitExcludePpn(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	invoiceDate := time.Date(2031, 3, 15, 0, 0, 0, 0, time.UTC)
	paidInvoiceFixture(t, ctx, tx, invoiceDate)

	repo := dashboard.NewRepo(tx, testutil.Store(t))
	from := time.Date(2031, 3, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2031, 4, 1, 0, 0, 0, 0, time.UTC)

	revenue, err := repo.Timeseries(ctx, "revenue", from, to, "month")
	require.NoError(t, err)
	require.Len(t, revenue, 1)
	require.True(t, mustDecimal(t, revenue[0].Value).Equal(decimal.NewFromInt(10000)),
		"revenue bucket must be DPP, got %s", revenue[0].Value)

	profit, err := repo.Timeseries(ctx, "profit", from, to, "month")
	require.NoError(t, err)
	require.Len(t, profit, 1)
	require.True(t, mustDecimal(t, profit[0].Value).Equal(decimal.NewFromInt(6000)),
		"profit bucket must be DPP minus cost, got %s", profit[0].Value)
}

// A window's totals equal its monthly sums.
// The export prints both, so Ringkasan must never disagree with Bulanan.
func TestRepo_Totals_EqualMonthlySums(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	paidInvoiceFixture(t, ctx, tx, time.Date(2031, 3, 15, 0, 0, 0, 0, time.UTC))
	repo := dashboard.NewRepo(tx, testutil.Store(t))

	cases := []struct {
		name     string
		from, to time.Time
		revenue  int64
	}{
		{"the fixture's year", time.Date(2031, 1, 1, 0, 0, 0, 0, time.UTC), time.Date(2032, 1, 1, 0, 0, 0, 0, time.UTC), 10000},
		{"the following year", time.Date(2032, 1, 1, 0, 0, 0, 0, time.UTC), time.Date(2033, 1, 1, 0, 0, 0, 0, time.UTC), 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, err := repo.Totals(ctx, &tc.from, &tc.to)
			require.NoError(t, err)
			require.True(t, mustDecimal(t, s.TotalRevenue).Equal(decimal.NewFromInt(tc.revenue)),
				"revenue want %d got %s", tc.revenue, s.TotalRevenue)

			sum := func(metric string) decimal.Decimal {
				points, err := repo.Timeseries(ctx, metric, tc.from, tc.to, "month")
				require.NoError(t, err)
				total := decimal.Zero
				for _, p := range points {
					total = total.Add(mustDecimal(t, p.Value))
				}
				return total
			}
			figures := []struct {
				metric string
				got    decimal.Decimal
			}{
				{"revenue", mustDecimal(t, s.TotalRevenue)},
				{"profit", mustDecimal(t, s.TotalProfit)},
				{"ppn", mustDecimal(t, s.TotalPpn)},
				{"invoice", decimal.NewFromInt(s.TotalInvoices)},
				{"quotation", decimal.NewFromInt(s.TotalQuotations)},
			}
			for _, f := range figures {
				want := sum(f.metric)
				assert.Truef(t, want.Equal(f.got), "%s: total %s, monthly sum %s", f.metric, f.got, want)
			}
		})
	}
}
