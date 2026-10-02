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
	// Accepting needs one offered line.
	_, err := tx.Exec(ctx, `
		INSERT INTO quotation_items (quotation_id, line_number, item_type, requested_name,
		                             offered_item_id, vendor_product_id, qty, unit_id,
		                             selling_price, cost_price, discount_pct, created_by)
		VALUES ($1, 1, 'product', 'Test Fixture Item', 9000001, 9000001, 1, 19, 10000, 5000, 0, $2)`,
		quotationID, seedUserID)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `SELECT fn_change_quotation_status($1, 'accepted', $2)`, quotationID, seedUserID)
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

// The total follows the PO lines.
// A PO edited after acceptance is what is delivered and invoiced, so the
// total, the minTotal filter and the totalPurchase sort read its lines; an
// accepted deal with no PO yet still counts at its quotation total.
func TestRepo_TotalPurchase_FollowsPOLines(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := clients.NewRepo(tx, testutil.Store(t))

	prefix := fmt.Sprintf("PT Ubah PO %d", time.Now().UnixNano())
	numbers := freeNumbers(t, tx, 2)
	newClient := func(name, number string) int64 {
		var id int64
		require.NoError(t, tx.QueryRow(ctx, `
			INSERT INTO company_client (number, name, country_code, created_by, updated_by)
			VALUES ($1, $2, 'IDN', $3, $3) RETURNING id`, number, name, seedUserID).Scan(&id))
		return id
	}
	quotation := func(clientID int64, name, status, total string) int64 {
		var id int64
		require.NoError(t, tx.QueryRow(ctx, `
			INSERT INTO quotations (quotation_no, company_client_id, company_client_name,
			                        discount_pct, total_produk, total, total_discount,
			                        status, created_by, updated_by)
			VALUES ($1, $2, $3, 0, $4::numeric, $4::numeric, 0, $5, $6, $6)
			RETURNING id`, "SQ-UBAH-"+name, clientID, name, total, status, seedUserID).Scan(&id))
		return id
	}

	edited := newClient(prefix+" A", numbers[0])
	quotationID := quotation(edited, prefix+" A", "sent", "10000")
	var lineID int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO quotation_items (quotation_id, line_number, item_type, requested_name,
		                             offered_item_id, vendor_product_id, qty, unit_id,
		                             selling_price, cost_price, discount_pct, created_by)
		VALUES ($1, 1, 'product', 'Test Fixture Item', 9000001, 9000001, 1, 19, 10000, 5000, 0, $2)
		RETURNING id`, quotationID, seedUserID).Scan(&lineID))
	_, err := tx.Exec(ctx, `SELECT fn_change_quotation_status($1, 'accepted', $2)`, quotationID, seedUserID)
	require.NoError(t, err)

	// Accepted before POs existed: no PO, so the quotation counts.
	noPO := newClient(prefix+" B", numbers[1])
	quotation(noPO, prefix+" B", "accepted", "7000")

	check := func(wantEdited string, wantOrder []int64, minRows int) {
		t.Helper()
		got, err := repo.GetByID(ctx, edited)
		require.NoError(t, err)
		assert.Equal(t, wantEdited, got.TotalPurchase, "clients.get_by_id")
		many, err := repo.GetByIDs(ctx, []int64{edited, noPO})
		require.NoError(t, err)
		assert.Equal(t, wantEdited, many[edited].TotalPurchase, "clients.get_by_ids")
		assert.Equal(t, "7770.00", many[noPO].TotalPurchase, "no PO falls back to the quotation")
		updated, err := repo.Update(ctx, edited,
			clients.UpdateClientRequest{Name: prefix + " A", CountryCode: "IDN", IsActive: true}, seedUserID)
		require.NoError(t, err)
		assert.Equal(t, wantEdited, updated.TotalPurchase, "clients.update")

		list, err := repo.List(ctx, clients.ListFilter{Q: prefix, SortBy: "totalPurchase", Limit: 10})
		require.NoError(t, err)
		ids := make([]int64, 0, len(list.Rows))
		for _, r := range list.Rows {
			ids = append(ids, r.ID)
		}
		assert.Equal(t, wantOrder, ids, "totalPurchase sort")

		filtered, err := repo.List(ctx, clients.ListFilter{Q: prefix, MinTotal: ptr("8000"), Limit: 10})
		require.NoError(t, err)
		assert.Len(t, filtered.Rows, minRows, "minTotal filter")
	}

	check("11100.00", []int64{edited, noPO}, 1)

	var poID int64
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT id FROM purchase_orders WHERE quotation_id = $1`, quotationID).Scan(&poID))
	_, err = tx.Exec(ctx, `SELECT fn_update_po_items($1, $2, 0, NULL, NULL, NULL, NULL, $3::jsonb)`,
		poID, seedUserID, fmt.Sprintf(
			`[{"quotationItemId":"%d","offeredItemId":"9000001","itemName":"Test Fixture Item",`+
				`"qty":"1","unitId":"19","sellingPrice":"6000","costPrice":"4000"}]`, lineID))
	require.NoError(t, err)

	check("6660.00", []int64{noPO, edited}, 0)
}
