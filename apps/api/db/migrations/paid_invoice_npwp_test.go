package migrations_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const paidNPWPMigration = "00123_paid_invoice_buyer_npwp.sql"

// npwpClient adds one client.
func npwpClient(ctx context.Context, t *testing.T, tx pgx.Tx, name string, npwp *string, country string) int64 {
	t.Helper()
	var id int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO company_client (number, name, npwp, country_code, created_by, updated_by)
		VALUES (fn_next_client_number(), $1, $2, $3, 1, 1) RETURNING id`, name, npwp, country).Scan(&id))
	return id
}

// npwpInvoice adds one invoice.
func npwpInvoice(ctx context.Context, t *testing.T, tx pgx.Tx, no string, quotation, client int64, buyer, status string, npwp *string) int64 {
	t.Helper()
	var id int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO invoices (invoice_no, quotation_id, company_client_id, buyer_name, buyer_npwp,
		                      invoice_date, status, created_by, updated_by)
		VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, 1, 1) RETURNING id`,
		no, quotation, client, buyer, npwp, status).Scan(&id))
	return id
}

// Paid invoices take a certain NPWP.
// Only a paid invoice whose client is certainly its buyer is filled; an
// open one, a renamed client, a client without a valid NPWP, a foreign one
// and one whose NPWP changed keep none.
func TestMigration00123_FillsPaidBuyerNPWP(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	qid, _ := quotationWithLine(ctx, t, tx, "Migrasi 00123", true)
	valid := "0123456789012345"
	other := "0999999999999999"
	short := "012345678901234"

	same := npwpClient(ctx, t, tx, "PT Pembeli Tetap", &valid, "IDN")
	renamed := npwpClient(ctx, t, tx, "PT Nama Baru", &valid, "IDN")
	noNPWP := npwpClient(ctx, t, tx, "PT Tanpa NPWP", &short, "IDN")
	foreign := npwpClient(ctx, t, tx, "Foreign Buyer Pte", &valid, "SGP")
	moved := npwpClient(ctx, t, tx, "PT Pernah Pindah", &valid, "IDN")
	npwpInvoice(ctx, t, tx, "INV-M123-OLD", qid, moved, "PT Pernah Pindah", "paid", &other)

	cases := []struct {
		name   string
		client int64
		buyer  string
		status string
		want   *string
	}{
		{"same buyer, paid", same, "PT. Pembeli  Tetap", "paid", &valid},
		{"same buyer, still open", same, "PT Pembeli Tetap", "sent", nil},
		{"client renamed since", renamed, "PT Nama Lama", "paid", nil},
		{"client NPWP not 16 digits", noNPWP, "PT Tanpa NPWP", "paid", nil},
		{"foreign buyer", foreign, "Foreign Buyer Pte", "paid", nil},
		{"client NPWP changed", moved, "PT Pernah Pindah", "paid", nil},
	}
	ids := make([]int64, len(cases))
	for i, tc := range cases {
		ids[i] = npwpInvoice(ctx, t, tx, "INV-M123-"+string(rune('A'+i)), qid, tc.client, tc.buyer, tc.status, nil)
	}

	_, err := tx.Exec(ctx, upSQL(t, paidNPWPMigration))
	require.NoError(t, err)

	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var got *string
			require.NoError(t, tx.QueryRow(ctx, `SELECT buyer_npwp FROM invoices WHERE id = $1`, ids[i]).Scan(&got))
			assert.Equal(t, tc.want, got)
		})
	}
}
