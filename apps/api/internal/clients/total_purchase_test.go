package clients_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Cancelled PO leaves the total.
// The quotation stays accepted, so every read path, the minTotal filter
// included, must drop the deal once its PO is cancelled.
func TestRepo_TotalPurchase_ExcludesCancelledPO(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := clients.NewRepo(tx, testutil.Store(t))

	name := fmt.Sprintf("PT Batal PO %d", time.Now().UnixNano())
	var clientID int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO company_client (number, name, country_code, created_by, updated_by)
		VALUES ($1, $2, 'IDN', $3, $3) RETURNING id`,
		*freeNumber(t, tx), name, seedUserID).Scan(&clientID))

	var quotationID int64
	var grandTotal string
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO quotations (quotation_no, company_client_id, company_client_name,
		                        discount_pct, total_produk, total, total_discount,
		                        status, created_by, updated_by)
		VALUES ($1, $2, $3, 0, 10000, 10000, 0, 'sent', $4, $4)
		RETURNING id, grand_total::text`,
		"SQ-BATAL-"+name, clientID, name, seedUserID).Scan(&quotationID, &grandTotal))
	_, err := tx.Exec(ctx, `SELECT fn_change_quotation_status($1, 'accepted', $2)`, quotationID, seedUserID)
	require.NoError(t, err)

	update := clients.UpdateClientRequest{Name: name, CountryCode: "IDN", IsActive: true}
	assertTotal := func(want string, minTotalRows int) {
		t.Helper()
		got, err := repo.GetByID(ctx, clientID)
		require.NoError(t, err)
		assert.Equal(t, want, got.TotalPurchase, "clients.get_by_id")

		many, err := repo.GetByIDs(ctx, []int64{clientID})
		require.NoError(t, err)
		assert.Equal(t, want, many[clientID].TotalPurchase, "clients.get_by_ids")

		list, err := repo.List(ctx, clients.ListFilter{Q: name, Limit: 10})
		require.NoError(t, err)
		require.Len(t, list.Rows, 1)
		assert.Equal(t, want, list.Rows[0].TotalPurchase, "clients.list_base")

		filtered, err := repo.List(ctx, clients.ListFilter{Q: name, MinTotal: ptr("1"), Limit: 10})
		require.NoError(t, err)
		assert.Len(t, filtered.Rows, minTotalRows, "minTotal filter")
		assert.Equal(t, int64(minTotalRows), filtered.Total, "minTotal count")

		updated, err := repo.Update(ctx, clientID, update, seedUserID)
		require.NoError(t, err)
		assert.Equal(t, want, updated.TotalPurchase, "clients.update")
	}

	assertTotal(grandTotal, 1)

	var poID int64
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT id FROM purchase_orders WHERE quotation_id = $1`, quotationID).Scan(&poID))
	_, err = tx.Exec(ctx, `SELECT fn_change_po_status($1, 'CANCELLED', $2, 'Klien membatalkan pesanan')`,
		poID, seedUserID)
	require.NoError(t, err)

	assertTotal("0", 0)
}
