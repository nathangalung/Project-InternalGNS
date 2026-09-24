package purchaseorders_test

import (
	"fmt"
	"net/http"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Line edits round-trip (PO-02).
// The edit wizard once dropped the discount, the notes and each line's
// destination and availability. PUT /items replaces all of them
// wholesale, so notes left out are cleared: the web resends the stored
// notes for that reason, and this pins the contract it relies on.
func TestHandler_UpdateItems_RoundTrip(t *testing.T) {
	ctx, tx, srv := txServer(t)
	_, poID := acceptedQuotationWithPO(t, tx)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	put := func(req purchaseorders.UpdateItemsRequest) {
		t.Helper()
		po, err := repo.GetByID(ctx, poID)
		require.NoError(t, err)
		res := doJSONWithHeaders(t, srv, http.MethodPut, fmt.Sprintf("/purchase-orders/%d/items", poID),
			req, map[string]string{"If-Match": strconv.Itoa(int(po.RowVersion))})
		defer res.Body.Close()
		require.Equal(t, http.StatusOK, res.StatusCode)
	}

	req := itemsWith(purchaseorders.UpdateItemsLine{ShipDestination: strPtr("Kapal A"), IsAvailable: new(bool)})
	req.DiscountPct = "12.5"
	req.Notes = strPtr("Kirim lewat dermaga 3")
	put(req)

	po, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	assert.Equal(t, "12.50", po.DiscountPct)
	require.NotNil(t, po.Notes)
	assert.Equal(t, "Kirim lewat dermaga 3", *po.Notes)
	items, err := repo.ListItems(ctx, poID)
	require.NoError(t, err)
	require.Len(t, items, 1)
	require.NotNil(t, items[0].ShipDestination)
	assert.Equal(t, "Kapal A", *items[0].ShipDestination)
	assert.False(t, items[0].IsAvailable)

	put(itemsWith(purchaseorders.UpdateItemsLine{}))
	po, err = repo.GetByID(ctx, poID)
	require.NoError(t, err)
	assert.Nil(t, po.Notes, "notes left out are cleared")
	assert.Equal(t, "0.00", po.DiscountPct)
	items, err = repo.ListItems(ctx, poID)
	require.NoError(t, err)
	require.Len(t, items, 1)
	assert.Nil(t, items[0].ShipDestination)
	assert.True(t, items[0].IsAvailable, "availability defaults to true")
}

// Note numbers are distinct (PO-07).
// Two POs of one client start work; the stored numbers must differ, and
// each is what the PO reports.
func TestRepo_DeliveryNoteNumbersAreDistinct(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, first := poAt(t, tx, purchaseorders.StatusOnProgress)
	_, second := poAt(t, tx, purchaseorders.StatusOnProgress)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))

	a, err := repo.GetByID(ctx, first)
	require.NoError(t, err)
	b, err := repo.GetByID(ctx, second)
	require.NoError(t, err)
	require.NotNil(t, a.DeliveryNoteNumber)
	require.NotNil(t, b.DeliveryNoteNumber)
	assert.NotEqual(t, *a.DeliveryNoteNumber, *b.DeliveryNoteNumber)

	var stored string
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT delivery_note_number FROM purchase_orders WHERE id = $1`, second).Scan(&stored))
	assert.Equal(t, stored, *b.DeliveryNoteNumber)
}
