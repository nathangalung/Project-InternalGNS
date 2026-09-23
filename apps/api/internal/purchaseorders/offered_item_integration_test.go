package purchaseorders_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Quote one line, optionally matched to a catalog item.
func acceptedQuotationWithOffer(t *testing.T, tx pgx.Tx, requested string, offered *int64) int64 {
	t.Helper()
	ctx := context.Background()
	qrepo := quotations.NewRepo(tx, testutil.Store(t))
	qid, err := qrepo.Create(ctx, quotations.CreateRequest{
		CompanyClientID: seedCompanyID,
		DiscountPct:     "0",
		Items: []quotations.CreateItem{{
			RequestedName: requested,
			RequestedImpa: strPtr("999999"),
			OfferedItemID: offered,
			Qty:           "2",
			UnitID:        seedUnitID,
			SellingPrice:  "100000",
		}},
	}, seedUserID)
	require.NoError(t, err)
	require.NoError(t, qrepo.ChangeStatus(ctx, qid, "sent", nil, seedUserID))
	require.NoError(t, qrepo.ChangeStatus(ctx, qid, "accepted", nil, seedUserID))

	po, err := purchaseorders.NewRepo(tx, testutil.Store(t)).GetByQuotation(ctx, qid)
	require.NoError(t, err)
	return po.ID
}

// The PO and its delivery note describe what is supplied, not what was asked
// for: documents naming the request text told nobody what was delivered.
func TestPurchaseOrder_SnapshotsOfferedItem(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)

	var wantName, wantCode string
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT name, impa_code FROM items WHERE id = $1`, seedItemID).Scan(&wantName, &wantCode))

	offered := seedItemID
	poID := acceptedQuotationWithOffer(t, tx, "tolong carikan punching tool", &offered)

	items, err := purchaseorders.NewRepo(tx, testutil.Store(t)).ListItems(ctx, poID)
	require.NoError(t, err)
	require.NotEmpty(t, items)
	assert.Equal(t, wantName, items[0].ItemName)
	require.NotNil(t, items[0].ItemCode)
	assert.Equal(t, wantCode, *items[0].ItemCode)
}

// An unmatched line still carries the customer's own words.
func TestPurchaseOrder_FallsBackToRequestedName(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	poID := acceptedQuotationWithOffer(t, tx, "barang tanpa padanan", nil)

	items, err := purchaseorders.NewRepo(tx, testutil.Store(t)).ListItems(ctx, poID)
	require.NoError(t, err)
	require.NotEmpty(t, items)
	assert.Equal(t, "barang tanpa padanan", items[0].ItemName)
	require.NotNil(t, items[0].ItemCode)
	assert.Equal(t, "999999", *items[0].ItemCode)
}

// A name typed in the edit wizard is not overwritten by the catalog.
func TestPurchaseOrder_EditedLineNameSurvives(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	offered := seedItemID
	poID := acceptedQuotationWithOffer(t, tx, "tolong carikan punching tool", &offered)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))

	_, err := repo.UpdateItems(ctx, poID, purchaseorders.UpdateItemsRequest{
		DiscountPct: "0",
		Items: []purchaseorders.UpdateItemsLine{{
			OfferedItemID: &offered,
			ItemName:      "Nama hasil kesepakatan",
			Qty:           "1",
			UnitID:        int16Ptr(seedUnitID),
			SellingPrice:  "100000",
		}},
	}, seedUserID, nil)
	require.NoError(t, err)

	items, err := repo.ListItems(ctx, poID)
	require.NoError(t, err)
	require.NotEmpty(t, items)
	assert.Equal(t, "Nama hasil kesepakatan", items[0].ItemName)
}
