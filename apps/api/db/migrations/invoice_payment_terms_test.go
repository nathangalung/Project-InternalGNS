package migrations_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const paymentTermsMigration = "00110_invoice_payment_terms.sql"

// Day counts read from terms.
// Only a plain count of days, optionally after Net, sets the due date;
// anything else is NULL and keeps the 30 day default.
func TestMigration00110_TermsDays(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	days := func(n int) *int { return &n }
	str := func(s string) *string { return &s }
	cases := []struct {
		name  string
		terms *string
		want  *int
	}{
		{"prod 30 days", str("30 days"), days(30)},
		{"prod 30 Days", str("30 Days"), days(30)},
		{"prod 7 days", str("7 days"), days(7)},
		{"prod 1 days", str("1 days"), days(1)},
		{"singular day", str("1 day"), days(1)},
		{"net prefix", str("Net 45 days"), days(45)},
		{"upper case", str("NET 60 DAYS"), days(60)},
		{"indonesian", str("14 hari"), days(14)},
		{"last day of the year", str("365 days"), days(365)},
		{"padded", str(" 30 days "), days(30)},
		{"no space before the unit", str("30days"), days(30)},
		{"no space after net", str("net30 days"), days(30)},
		{"advance payment", str("Payment in Advance (Before Delivery)"), nil},
		{"advance payment lower", str("Advance payment (before delivery)"), nil},
		{"transfer or cash", str("TRANSFER - CASH"), nil},
		{"zero days", str("0 days"), nil},
		{"past a year", str("366 days"), nil},
		{"four digits", str("1000 days"), nil},
		{"working days", str("30 hari kerja"), nil},
		{"no unit", str("Net 30"), nil},
		{"words after", str("30 days after delivery"), nil},
		{"blank", str("   "), nil},
		{"empty", str(""), nil},
		{"null", nil, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var got *int
			require.NoError(t, tx.QueryRow(ctx, `SELECT fn_terms_days($1)`, tc.terms).Scan(&got))
			assert.Equal(t, tc.want, got)
		})
	}
}

// Filed invoices are not restated.
// Down then Up leaves an invoice issued before the column with no terms
// and its due date as it was, so a reprint prints the configured default.
func TestMigration00110_KeepsExistingInvoices(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	qid, err := quotations.NewRepo(tx, testutil.Store(t)).Create(ctx, quotations.CreateRequest{
		ValidityDays:    testutil.Validity(),
		CompanyClientID: 1,
		DiscountPct:     "0",
		Items: testutil.OfferLines(t, ctx, tx, []quotations.CreateItem{
			{RequestedName: "Migrasi 00110", Qty: "1", UnitID: 19, SellingPrice: "1000"},
		}),
	}, 1)
	require.NoError(t, err)

	_, err = tx.Exec(ctx, downSQL(t, paymentTermsMigration))
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `UPDATE quotations SET payment_terms = '7 days' WHERE id = $1`, qid)
	require.NoError(t, err)
	var invoice int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO invoices (invoice_no, quotation_id, company_client_id, buyer_name, invoice_date, due_date, status, created_by, updated_by)
		VALUES ('INV-MIG-00110', $1, 1, 'PT Pembeli', DATE '2026-03-02', DATE '2026-04-01', 'sent', 1, 1) RETURNING id`, qid).Scan(&invoice))

	_, err = tx.Exec(ctx, upSQL(t, paymentTermsMigration))
	require.NoError(t, err)

	var terms *string
	var due time.Time
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT payment_terms, due_date FROM invoices WHERE id = $1`, invoice).Scan(&terms, &due))
	assert.Nil(t, terms, "an issued invoice gains no terms")
	assert.Equal(t, "2026-04-01", due.Format(time.DateOnly), "its due date stays")
}
