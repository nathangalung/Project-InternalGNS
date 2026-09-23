package dashboard_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/dashboard"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// tileCounts maps status to count.
func tileCounts(tiles []dashboard.StatusCount) map[string]int64 {
	out := make(map[string]int64, len(tiles))
	for _, c := range tiles {
		out[c.Status] = c.Count
	}
	return out
}

func tileKeys(tiles []dashboard.StatusCount) []string {
	out := make([]string, 0, len(tiles))
	for _, c := range tiles {
		out = append(out, c.Status)
	}
	return out
}

// insertQuotation adds a quotation.
func insertQuotation(ctx context.Context, t *testing.T, tx pgx.Tx, no, status string) int64 {
	t.Helper()
	var id int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO quotations (quotation_no, company_client_id, company_client_name,
		                        discount_pct, total_produk, total, total_discount,
		                        status, created_by, updated_by)
		VALUES ($1, 1, 'PT. IMC Ship Management', 0, 10000, 10000, 0, $2, 1, 1)
		RETURNING id`, no, status).Scan(&id))
	return id
}

// Tiles come in one order.
// Every status has a tile, zero or not, so the page never hardcodes them.
func TestRepo_Summary_TileOrder(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	s, err := dashboard.NewRepo(tx, testutil.Store(t)).Summary(ctx)
	require.NoError(t, err)

	assert.Equal(t, []string{"draft", "sent", "revision", "accepted", "rejected", "cancelled", "expired"}, tileKeys(s.QuotationStatuses))
	assert.Equal(t, []string{"PENDING", "UPLOADED", "ON_PROGRESS", "DELIVERED", "CANCELLED"}, tileKeys(s.PoStatuses))
	assert.Equal(t, []string{"draft", "sent", "overdue", "paid", "cancelled"}, tileKeys(s.InvoiceStatuses))

	labels := map[string]string{}
	for _, c := range s.QuotationStatuses {
		labels[c.Status] = c.Label
	}
	assert.Equal(t, "Ditolak", labels["rejected"])
	assert.Equal(t, "Dibatalkan", labels["cancelled"])
	assert.Equal(t, "Kedaluwarsa", labels["expired"])
}

// Ditolak counts only rejected.
// Kedaluwarsa is its own tile, never folded into Ditolak.
func TestRepo_Summary_RejectedExcludesExpired(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := dashboard.NewRepo(tx, testutil.Store(t))
	before, err := repo.Summary(ctx)
	require.NoError(t, err)

	insertQuotation(ctx, t, tx, "SQ-TILE-REJ", "rejected")
	insertQuotation(ctx, t, tx, "SQ-TILE-EXP", "expired")

	after, err := repo.Summary(ctx)
	require.NoError(t, err)
	assert.Equal(t, int64(1), after.TotalQuotationsRejected-before.TotalQuotationsRejected)

	b, a := tileCounts(before.QuotationStatuses), tileCounts(after.QuotationStatuses)
	assert.Equal(t, int64(1), a["rejected"]-b["rejected"])
	assert.Equal(t, int64(1), a["expired"]-b["expired"])
	assert.Equal(t, int64(0), a["cancelled"]-b["cancelled"])
}

// Past-due sent is Terlambat.
func TestRepo_Summary_OverdueIsDerived(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := dashboard.NewRepo(tx, testutil.Store(t))
	before, err := repo.Summary(ctx)
	require.NoError(t, err)

	qid := insertQuotation(ctx, t, tx, "SQ-TILE-OVD", "accepted")
	_, err = tx.Exec(ctx, `
		INSERT INTO invoices (invoice_no, quotation_id, company_client_id,
		                      invoice_date, due_date, subtotal, dpp, total, status,
		                      created_by, updated_by)
		VALUES ('INV-TILE-OVD', $1, 1, CURRENT_DATE - 40, CURRENT_DATE - 10,
		        10000, 10000, 11100, 'sent', 1, 1)`, qid)
	require.NoError(t, err)

	after, err := repo.Summary(ctx)
	require.NoError(t, err)
	b, a := tileCounts(before.InvoiceStatuses), tileCounts(after.InvoiceStatuses)
	assert.Equal(t, int64(1), a["overdue"]-b["overdue"])
	assert.Equal(t, int64(0), a["sent"]-b["sent"])
}
