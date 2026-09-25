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

const (
	seedItemID            int64 = 1
	incompleteVendorID    int64 = 2
	incompleteVendorLabel       = "CV Marine Supply"
)

// Accept a one-vendor catalog quote.
// One catalog item comes from one vendor.
func acceptedQuotationWithVendor(t *testing.T, tx pgx.Tx, companyID int64) int64 {
	t.Helper()
	ctx := context.Background()

	var vendorProductID int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO vendor_products (vendor_id, item_id, cost_price, created_by, updated_by)
		VALUES ($1, $2, 50000, $3, $3)
		RETURNING id`, incompleteVendorID, seedItemID, seedUserID).Scan(&vendorProductID))

	qrepo := quotations.NewRepo(tx, testutil.Store(t))
	offered := seedItemID
	qid, err := qrepo.Create(ctx, quotations.CreateRequest{
		CompanyClientID: companyID,
		DiscountPct:     "0",
		Items: []quotations.CreateItem{{
			RequestedName:   "Test Product",
			OfferedItemID:   &offered,
			VendorProductID: &vendorProductID,
			Qty:             "2",
			UnitID:          seedUnitID,
			SellingPrice:    "100000",
			CostPrice:       strPtr("50000"),
		}},
	}, seedUserID)
	require.NoError(t, err)
	require.NoError(t, qrepo.ChangeStatus(ctx, qid, "sent", nil, seedUserID))
	require.NoError(t, qrepo.ChangeStatus(ctx, qid, "accepted", nil, seedUserID))

	po, err := purchaseorders.NewRepo(tx, testutil.Store(t)).GetByQuotation(ctx, qid)
	require.NoError(t, err)
	return po.ID
}

// Lines carry their supplying vendor.
// One response carries every line's vendor.
func TestRepo_ListItems_CarriesVendor(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	poID := acceptedQuotationWithVendor(t, tx, seedCompanyID)

	items, err := purchaseorders.NewRepo(tx, testutil.Store(t)).ListItems(ctx, poID)
	require.NoError(t, err)
	require.NotEmpty(t, items)

	require.NotNil(t, items[0].VendorID)
	assert.Equal(t, incompleteVendorID, *items[0].VendorID)
	require.NotNil(t, items[0].VendorName)
	assert.Equal(t, incompleteVendorLabel, *items[0].VendorName)
}

// Server answers the ON_PROGRESS gate.
// It takes one round trip.
func TestRepo_Completeness(t *testing.T) {
	t.Run("complete client and no vendor", func(t *testing.T) {
		ctx, tx := testutil.BeginTx(t)
		_, poID := acceptedQuotationWithPO(t, tx)

		issues, err := purchaseorders.NewRepo(tx, testutil.Store(t)).Completeness(ctx, poID)
		require.NoError(t, err)
		assert.Empty(t, issues)
	})

	t.Run("incomplete vendor is reported", func(t *testing.T) {
		ctx, tx := testutil.BeginTx(t)
		poID := acceptedQuotationWithVendor(t, tx, seedCompanyID)

		issues, err := purchaseorders.NewRepo(tx, testutil.Store(t)).Completeness(ctx, poID)
		require.NoError(t, err)
		require.Len(t, issues, 1)
		assert.Equal(t, "vendor", issues[0].Scope)
		assert.Equal(t, incompleteVendorID, issues[0].ID)
		assert.Equal(t, []string{"Email atau Nomor Telepon"}, issues[0].Missing)
	})

	t.Run("incomplete client is reported", func(t *testing.T) {
		ctx, tx := testutil.BeginTx(t)
		poID := acceptedQuotationForCompany(t, tx, secondCompanyID)

		issues, err := purchaseorders.NewRepo(tx, testutil.Store(t)).Completeness(ctx, poID)
		require.NoError(t, err)
		require.Len(t, issues, 1)
		assert.Equal(t, "klien", issues[0].Scope)
		assert.Equal(t, secondCompanyID, issues[0].ID)
		assert.Equal(t, []string{
			"NPWP", "Alamat", "Nama Narahubung", "Email atau Nomor Telepon Narahubung",
		}, issues[0].Missing)
	})

	t.Run("unknown PO is not found", func(t *testing.T) {
		ctx, tx := testutil.BeginTx(t)
		_, err := purchaseorders.NewRepo(tx, testutil.Store(t)).Completeness(ctx, 99999999)
		assert.ErrorIs(t, err, purchaseorders.ErrNotFound)
	})
}
