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
	seedUserID    int64 = 1
	seedCompanyID int64 = 1
	seedUnitID    int16 = 19
)

// Accept quotation, return PO.
func acceptedQuotationWithPO(t *testing.T, tx pgx.Tx) (int64, int64) {
	t.Helper()
	ctx := context.Background()
	qrepo := quotations.NewRepo(tx, testutil.Store(t))
	qid, err := qrepo.Create(ctx, quotations.CreateRequest{
		CompanyClientID: seedCompanyID,
		DiscountPct:     "0",
		Items: []quotations.CreateItem{{
			RequestedName: "Test Product",
			Qty:           "2",
			UnitID:        seedUnitID,
			SellingPrice:  "100000",
		}},
	}, seedUserID)
	require.NoError(t, err)
	require.NoError(t, qrepo.ChangeStatus(ctx, qid, "sent", nil, seedUserID))
	require.NoError(t, qrepo.ChangeStatus(ctx, qid, "accepted", nil, seedUserID))

	porepo := purchaseorders.NewRepo(tx, testutil.Store(t))
	po, err := porepo.GetByQuotation(ctx, qid)
	require.NoError(t, err)
	return qid, po.ID
}

func TestRepo_GetByQuotation(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	qid, poID := acceptedQuotationWithPO(t, tx)

	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	po, err := repo.GetByQuotation(ctx, qid)
	require.NoError(t, err)
	assert.Equal(t, poID, po.ID)
	assert.Equal(t, purchaseorders.StatusPending, po.Status)
	assert.NotEmpty(t, po.PoNumber)
}

func TestRepo_GetByID(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID := acceptedQuotationWithPO(t, tx)

	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	po, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	assert.Equal(t, poID, po.ID)
}

func TestRepo_GetByID_NotFound(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))

	_, err := repo.GetByID(ctx, 99999999)
	assert.ErrorIs(t, err, purchaseorders.ErrNotFound)
}

func TestRepo_List(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	acceptedQuotationWithPO(t, tx)

	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	res, err := repo.List(ctx, purchaseorders.ListFilter{Limit: 50})
	require.NoError(t, err)
	assert.NotEmpty(t, res.Rows)
	assert.GreaterOrEqual(t, res.Total, int64(1))
}

func TestRepo_ChangeStatus_FullLifecycle(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID := acceptedQuotationWithPO(t, tx)

	repo := purchaseorders.NewRepo(tx, testutil.Store(t))

	require.NoError(t, repo.ChangeStatus(ctx, poID, purchaseorders.StatusUploaded, seedUserID))
	require.NoError(t, repo.ChangeStatus(ctx, poID, purchaseorders.StatusOnProgress, seedUserID))
	require.NoError(t, repo.ChangeStatus(ctx, poID, purchaseorders.StatusDelivered, seedUserID))

	po, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	assert.Equal(t, purchaseorders.StatusDelivered, po.Status)
}

func TestRepo_ChangeStatus_DeliveredStampsDeliveryNote(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID := acceptedQuotationWithPO(t, tx)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))

	require.NoError(t, repo.ChangeStatus(ctx, poID, purchaseorders.StatusUploaded, seedUserID))
	require.NoError(t, repo.ChangeStatus(ctx, poID, purchaseorders.StatusOnProgress, seedUserID))
	require.NoError(t, repo.ChangeStatus(ctx, poID, purchaseorders.StatusDelivered, seedUserID))

	var dn *string
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT delivery_note_number FROM purchase_orders WHERE id = $1`, poID).Scan(&dn))
	require.NotNil(t, dn)
	assert.Contains(t, *dn, "DN-")

	// Reverting from DELIVERED is blocked once the invoice exists. The raise
	// aborts the surrounding transaction, so the error itself is the assertion.
	require.Error(t, repo.ChangeStatus(ctx, poID, purchaseorders.StatusOnProgress, seedUserID))
}

func TestRepo_ChangeStatus_DeliveredSnapshotsGoodsOrService(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	qID, poID := acceptedQuotationWithPO(t, tx)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))

	require.NoError(t, repo.ChangeStatus(ctx, poID, purchaseorders.StatusUploaded, seedUserID))
	require.NoError(t, repo.ChangeStatus(ctx, poID, purchaseorders.StatusOnProgress, seedUserID))
	require.NoError(t, repo.ChangeStatus(ctx, poID, purchaseorders.StatusDelivered, seedUserID))

	rows, err := tx.Query(ctx, `
		SELECT line_type, goods_or_service
		FROM invoice_items
		WHERE invoice_id = (SELECT id FROM invoices WHERE quotation_id = $1)
		ORDER BY line_number`, qID)
	require.NoError(t, err)
	defer rows.Close()

	seen := map[string]string{}
	for rows.Next() {
		var lt string
		var gos *string
		require.NoError(t, rows.Scan(&lt, &gos))
		require.NotNil(t, gos, "goods_or_service must be populated")
		seen[lt] = *gos
	}
	assert.Equal(t, "B", seen["product"])
	if v, ok := seen["shipping"]; ok {
		assert.Equal(t, "J", v)
	}
}

func TestRepo_ChangeStatus_RejectsInvalidTransition(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID := acceptedQuotationWithPO(t, tx)

	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	err := repo.ChangeStatus(ctx, poID, purchaseorders.StatusDelivered, seedUserID)
	assert.ErrorIs(t, err, purchaseorders.ErrInvalidTransition)
}

func TestRepo_ChangeStatus_NotFound(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))

	err := repo.ChangeStatus(ctx, 99999999, purchaseorders.StatusUploaded, seedUserID)
	assert.ErrorIs(t, err, purchaseorders.ErrNotFound)
}

func TestRepo_UpdateNotes(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID := acceptedQuotationWithPO(t, tx)

	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	require.NoError(t, repo.UpdateNotes(ctx, poID, "added by test", seedUserID))

	po, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	require.NotNil(t, po.Notes)
	assert.Equal(t, "added by test", *po.Notes)
}

func TestRepo_UpdateFile_AdvancesPendingToUploaded(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID := acceptedQuotationWithPO(t, tx)

	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	require.NoError(t, repo.UpdateFile(ctx, poID, purchaseorders.UpdateFileRequest{
		FileName:  "po.pdf",
		FileSize:  1024,
		ObjectKey: "data:application/pdf;base64,",
	}, seedUserID))

	po, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	assert.Equal(t, purchaseorders.StatusUploaded, po.Status)
	require.NotNil(t, po.FileName)
	assert.Equal(t, "po.pdf", *po.FileName)
}

func TestRepo_UpdateFile_NotFound(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))

	err := repo.UpdateFile(ctx, 99999999, purchaseorders.UpdateFileRequest{
		FileName: "x.pdf", FileSize: 1, ObjectKey: "x",
	}, seedUserID)
	assert.ErrorIs(t, err, purchaseorders.ErrNotFound)
}

func TestRepo_UpdateItems_ReplacesAndUpdatesDiscount(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID := acceptedQuotationWithPO(t, tx)

	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	notes := "edited"
	addr := "Jakarta Pusat"
	cost := "50000"
	req := purchaseorders.UpdateItemsRequest{
		DiscountPct:     "5",
		Notes:           &notes,
		ShippingAddress: &addr,
		ShippingCost:    &cost,
		Items: []purchaseorders.UpdateItemsLine{{
			ItemName:     "Edited Item",
			Qty:          "3",
			UnitID:       int16Ptr(seedUnitID),
			SellingPrice: "200000",
			CostPrice:    strPtr("150000"),
		}},
	}
	newVersion, err := repo.UpdateItems(ctx, poID, req, seedUserID, nil)
	require.NoError(t, err)
	assert.Greater(t, newVersion, int32(0))

	items, err := repo.ListItems(ctx, poID)
	require.NoError(t, err)
	require.Len(t, items, 2)
	assert.Equal(t, "Edited Item", items[0].ItemName)
	assert.Equal(t, "shipping", items[1].ItemType)
}

func TestRepo_UpdateItems_NotFound(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))

	_, err := repo.UpdateItems(ctx, 99999999, purchaseorders.UpdateItemsRequest{
		DiscountPct: "0",
		Items:       []purchaseorders.UpdateItemsLine{},
	}, seedUserID, nil)
	assert.ErrorIs(t, err, purchaseorders.ErrNotFound)
}

func TestRepo_UpdateItems_LockedWhenDelivered(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID := acceptedQuotationWithPO(t, tx)

	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	require.NoError(t, repo.ChangeStatus(ctx, poID, purchaseorders.StatusUploaded, seedUserID))
	require.NoError(t, repo.ChangeStatus(ctx, poID, purchaseorders.StatusOnProgress, seedUserID))
	require.NoError(t, repo.ChangeStatus(ctx, poID, purchaseorders.StatusDelivered, seedUserID))

	_, err := repo.UpdateItems(ctx, poID, purchaseorders.UpdateItemsRequest{
		DiscountPct: "0",
		Items:       []purchaseorders.UpdateItemsLine{},
	}, seedUserID, nil)
	assert.ErrorIs(t, err, purchaseorders.ErrLocked)
}

func TestRepo_UpdateItems_VersionMatch(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID := acceptedQuotationWithPO(t, tx)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))

	po, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	current := po.RowVersion

	newVersion, err := repo.UpdateItems(ctx, poID, purchaseorders.UpdateItemsRequest{
		DiscountPct: "5",
		Items: []purchaseorders.UpdateItemsLine{{
			ItemName: "X", Qty: "1", UnitID: int16Ptr(seedUnitID), SellingPrice: "1000",
		}},
	}, seedUserID, &current)
	require.NoError(t, err)
	assert.Greater(t, newVersion, current)
}

func TestRepo_UpdateItems_VersionMismatch(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID := acceptedQuotationWithPO(t, tx)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))

	stale := int32(999)
	_, err := repo.UpdateItems(ctx, poID, purchaseorders.UpdateItemsRequest{
		DiscountPct: "5",
		Items: []purchaseorders.UpdateItemsLine{{
			ItemName: "X", Qty: "1", UnitID: int16Ptr(seedUnitID), SellingPrice: "1000",
		}},
	}, seedUserID, &stale)
	assert.ErrorIs(t, err, purchaseorders.ErrVersionMismatch)
}

func TestRepo_UpdateItems_VersionedNotFound(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))

	zero := int32(0)
	_, err := repo.UpdateItems(ctx, 99999999, purchaseorders.UpdateItemsRequest{
		DiscountPct: "0",
		Items:       []purchaseorders.UpdateItemsLine{},
	}, seedUserID, &zero)
	assert.ErrorIs(t, err, purchaseorders.ErrNotFound)
}

func int16Ptr(v int16) *int16 { return &v }
func strPtr(v string) *string { return &v }
