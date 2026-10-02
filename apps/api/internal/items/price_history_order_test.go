package items_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Price history order is total.
//
// Quotations made in one transaction share created_at, and one quotation can
// offer the item on several lines, so the order falls back to the newest
// quotation id and then the line number, whatever order the rows were written.
func TestRepo_SuggestSellingPrices_TieBreak(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))

	it, err := repo.Create(ctx, items.CreateItemRequest{Name: "PRICE HISTORY TIEBREAK"}, seedUserID)
	require.NoError(t, err)

	quotation := func(no string) int64 {
		var id int64
		require.NoError(t, tx.QueryRow(ctx, `
			INSERT INTO quotations (quotation_no, company_client_id, company_client_name, contact_name,
			                        discount_pct, total_produk, total, total_discount,
			                        status, created_by, updated_by)
			SELECT $1, id, name, 'Narahubung', 0, 0, 0, 0, 'sent', 1, 1
			FROM company_client ORDER BY id LIMIT 1 RETURNING id`, no).Scan(&id))
		return id
	}
	line := func(qid int64, n int, price string) {
		_, err := tx.Exec(ctx, `
			INSERT INTO quotation_items (quotation_id, line_number, item_type, requested_name,
			                             offered_item_id, qty, unit_id, selling_price, cost_price,
			                             discount_pct, created_by)
			VALUES ($1, $2, 'product', 'PRICE HISTORY TIEBREAK', $3, 1,
			        (SELECT id FROM units ORDER BY id LIMIT 1), $4::numeric, 50, 0, 1)`,
			qid, n, it.ID, price)
		require.NoError(t, err)
	}

	older := quotation("SQ-TIEBREAK-A")
	line(older, 2, "200")
	line(older, 1, "100")
	newer := quotation("SQ-TIEBREAK-B")
	line(newer, 1, "300")

	hist, err := repo.SuggestSellingPrices(ctx, it.ID, 5)
	require.NoError(t, err)
	got := make([]string, 0, len(hist))
	for _, h := range hist {
		got = append(got, h.QuotationNo+" "+h.SellingPrice)
	}
	assert.Equal(t, []string{
		"SQ-TIEBREAK-B 300.00",
		"SQ-TIEBREAK-A 100.00",
		"SQ-TIEBREAK-A 200.00",
	}, got)

	cut, err := repo.SuggestSellingPrices(ctx, it.ID, 2)
	require.NoError(t, err)
	require.Len(t, cut, 2)
	assert.Equal(t, "100.00", cut[1].SellingPrice, "the limit keeps the lower line number")
}
