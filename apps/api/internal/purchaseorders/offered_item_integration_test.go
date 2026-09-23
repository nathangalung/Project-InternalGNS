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
// for: documents naming the request text told nobody what was delivered. The
// code travels with the name, so a catalog item without an IMPA code never
// borrows the customer's requested code.
func TestPurchaseOrder_SnapshotsLineIdentity(t *testing.T) {
	cases := []struct {
		name     string
		offered  func(t *testing.T, tx pgx.Tx) *int64
		wantName func(t *testing.T, tx pgx.Tx, id *int64) string
		wantCode func(t *testing.T, tx pgx.Tx, id *int64) *string
	}{
		{
			name:     "offered item with code",
			offered:  func(*testing.T, pgx.Tx) *int64 { id := seedItemID; return &id },
			wantName: catalogName,
			wantCode: catalogCode,
		},
		{
			name:     "offered item without code",
			offered:  insertUncodedItem,
			wantName: catalogName,
			wantCode: func(*testing.T, pgx.Tx, *int64) *string { return nil },
		},
		{
			name:     "unmatched request",
			offered:  func(*testing.T, pgx.Tx) *int64 { return nil },
			wantName: func(*testing.T, pgx.Tx, *int64) string { return "tolong carikan punching tool" },
			wantCode: func(*testing.T, pgx.Tx, *int64) *string { return strPtr("999999") },
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			offered := tc.offered(t, tx)
			poID := acceptedQuotationWithOffer(t, tx, "tolong carikan punching tool", offered)

			items, err := purchaseorders.NewRepo(tx, testutil.Store(t)).ListItems(ctx, poID)
			require.NoError(t, err)
			require.NotEmpty(t, items)
			assert.Equal(t, tc.wantName(t, tx, offered), items[0].ItemName)
			assert.Equal(t, tc.wantCode(t, tx, offered), items[0].ItemCode)
		})
	}
}

func catalogName(t *testing.T, tx pgx.Tx, id *int64) string {
	t.Helper()
	var name string
	require.NoError(t, tx.QueryRow(context.Background(),
		`SELECT name FROM items WHERE id = $1`, *id).Scan(&name))
	return name
}

// Code of a catalog item that has one.
func catalogCode(t *testing.T, tx pgx.Tx, id *int64) *string {
	t.Helper()
	var code *string
	require.NoError(t, tx.QueryRow(context.Background(),
		`SELECT NULLIF(impa_code, '') FROM items WHERE id = $1`, *id).Scan(&code))
	require.NotNil(t, code, "fixture item %d has no IMPA code", *id)
	return code
}

// Catalog item with no IMPA code.
func insertUncodedItem(t *testing.T, tx pgx.Tx) *int64 {
	t.Helper()
	var id int64
	require.NoError(t, tx.QueryRow(context.Background(),
		`INSERT INTO items (name, default_unit_id, created_by, updated_by)
		 VALUES ('Barang katalog tanpa IMPA', $1, $2, $2) RETURNING id`,
		seedUnitID, seedUserID).Scan(&id))
	return &id
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
