package migrations_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Every price ratio fits.
// A quotation line and its PO line take the widest ratio the NUMERIC(15,2)
// prices can make, harga beli 0,01 against the largest harga jual, and the
// low ones a real line reaches.
func TestMigration00119_ProfitPctHoldsEveryRatio(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	qrepo := quotations.NewRepo(tx, testutil.Store(t))
	qid, err := qrepo.Create(ctx, quotations.CreateRequest{
		ValidityDays:    testutil.Validity(),
		CompanyClientID: 1,
		DiscountPct:     "0",
		Items: testutil.OfferLines(t, ctx, tx, []quotations.CreateItem{
			{RequestedName: "Migrasi 00119", Qty: "1", UnitID: 19, SellingPrice: "1000"},
		}),
	}, 1)
	require.NoError(t, err)
	require.NoError(t, qrepo.ChangeStatus(ctx, qid, "sent", nil, 1))
	require.NoError(t, qrepo.ChangeStatus(ctx, qid, "accepted", nil, 1))

	for _, table := range []string{"quotation_items", "purchase_order_items"} {
		var typ string
		require.NoError(t, tx.QueryRow(ctx, `
			SELECT format_type(atttypid, atttypmod) FROM pg_attribute
			WHERE attrelid = $1::regclass AND attname = 'profit_pct'`, table).Scan(&typ))
		assert.Equal(t, "numeric(19,4)", typ, table)
	}

	tests := []struct {
		name, selling, cost, pct string
	}{
		{"typed 400.000 read as 400", "900000", "400", "2249.0000"},
		{"cost 1.000 against 1.100.000", "1100000", "1000", "1099.0000"},
		{"the widest ratio", "9999999999999.99", "0.01", "999999999999998.0000"},
	}
	for _, tc := range tests {
		var q, po string
		require.NoError(t, tx.QueryRow(ctx, `
			UPDATE quotation_items SET selling_price = $2::numeric, cost_price = $3::numeric
			WHERE quotation_id = $1 AND item_type = 'product'
			RETURNING profit_pct::text`, qid, tc.selling, tc.cost).Scan(&q), tc.name)
		require.NoError(t, tx.QueryRow(ctx, `
			UPDATE purchase_order_items poi SET selling_price = $2::numeric, cost_price = $3::numeric
			FROM purchase_orders p
			WHERE p.id = poi.po_id AND p.quotation_id = $1 AND poi.item_type = 'product'
			RETURNING poi.profit_pct::text`, qid, tc.selling, tc.cost).Scan(&po), tc.name)
		assert.Equal(t, tc.pct, q, "quotation line, %s", tc.name)
		assert.Equal(t, tc.pct, po, "PO line, %s", tc.name)
	}
}
