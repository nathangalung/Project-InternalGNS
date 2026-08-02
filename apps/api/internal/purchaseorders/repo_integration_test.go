package purchaseorders_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
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

// Migration 00046: the invoice guard raises P0013, so the caller learns the
// real reason instead of the generic invalid-transition error 00035 collapsed
// into. The raise aborts the transaction, so it is the last DB action here.
func TestRepo_ChangeStatus_RevertBlockedByInvoiceReportsReason(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID := acceptedQuotationWithPO(t, tx)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))

	require.NoError(t, repo.ChangeStatus(ctx, poID, purchaseorders.StatusUploaded, seedUserID))
	require.NoError(t, repo.ChangeStatus(ctx, poID, purchaseorders.StatusOnProgress, seedUserID))
	require.NoError(t, repo.ChangeStatus(ctx, poID, purchaseorders.StatusDelivered, seedUserID))

	err := repo.ChangeStatus(ctx, poID, purchaseorders.StatusOnProgress, seedUserID)
	require.Error(t, err)
	assert.ErrorIs(t, err, purchaseorders.ErrLocked)
	assert.NotErrorIs(t, err, purchaseorders.ErrInvalidTransition)
	assert.Contains(t, err.Error(), "has an invoice; cannot revert from DELIVERED")
}

// The DELIVERED edit lock shares P0013 with the invoice guard but keeps its
// own 422: the handler matches ErrLocked before falling through to FromDBErr.
func TestRepo_UpdateItems_DeliveredIsLocked(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID := acceptedQuotationWithPO(t, tx)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))

	require.NoError(t, repo.ChangeStatus(ctx, poID, purchaseorders.StatusUploaded, seedUserID))
	require.NoError(t, repo.ChangeStatus(ctx, poID, purchaseorders.StatusOnProgress, seedUserID))
	require.NoError(t, repo.ChangeStatus(ctx, poID, purchaseorders.StatusDelivered, seedUserID))

	var rowVersion int32
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT row_version FROM purchase_orders WHERE id = $1`, poID).Scan(&rowVersion))

	_, err := repo.UpdateItems(ctx, poID, purchaseorders.UpdateItemsRequest{
		DiscountPct: "0",
		Items:       []purchaseorders.UpdateItemsLine{},
	}, seedUserID, &rowVersion)
	require.Error(t, err)
	assert.ErrorIs(t, err, purchaseorders.ErrLocked)
	assert.Contains(t, err.Error(), "Cannot edit PO in DELIVERED state")
}

// Migration 00046: fn_update_po_items validation now raises the typed P0014
// rather than the untyped P0001, and the handler's default branch still
// renders 422 carrying the raise message.
func TestRepo_UpdateItems_DiscountOutOfRangeIsUnprocessable(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID := acceptedQuotationWithPO(t, tx)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))

	var rowVersion int32
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT row_version FROM purchase_orders WHERE id = $1`, poID).Scan(&rowVersion))

	_, err := repo.UpdateItems(ctx, poID, purchaseorders.UpdateItemsRequest{
		DiscountPct: "150",
		Items:       []purchaseorders.UpdateItemsLine{},
	}, seedUserID, &rowVersion)
	require.Error(t, err)
	assert.NotErrorIs(t, err, purchaseorders.ErrNotFound)
	assert.NotErrorIs(t, err, purchaseorders.ErrLocked)
	assert.NotErrorIs(t, err, purchaseorders.ErrVersionMismatch)

	var pgErr *pgconn.PgError
	require.ErrorAs(t, err, &pgErr)
	assert.Equal(t, "P0014", pgErr.Code)

	// The handler falls through to RenderDBErr, so FromDBErr is the contract.
	e := httperr.FromDBErr(err)
	assert.Equal(t, http.StatusUnprocessableEntity, e.Status)
	// Prose, so it rides in Detail; a "db" field key would toast as a label.
	assert.Equal(t, "discount_pct must be between 0 and 100", e.Detail)
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

// Shipping days survive create then update.
func TestRepo_ShippingDays_RoundTrip(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	poID := acceptedQuotationWithShipping(t, tx, 7)

	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	created, err := repo.ListItems(ctx, poID)
	require.NoError(t, err)
	createdShip := shippingLine(t, created)
	require.NotNil(t, createdShip.ShippingDays)
	assert.Equal(t, 7, *createdShip.ShippingDays)

	addr := "Jakarta Pusat"
	cost := "50000"
	days := 12
	_, err = repo.UpdateItems(ctx, poID, purchaseorders.UpdateItemsRequest{
		DiscountPct:     "0",
		ShippingAddress: &addr,
		ShippingDays:    &days,
		ShippingCost:    &cost,
		Items: []purchaseorders.UpdateItemsLine{{
			ItemName:     "Edited Item",
			Qty:          "3",
			UnitID:       int16Ptr(seedUnitID),
			SellingPrice: "200000",
		}},
	}, seedUserID, nil)
	require.NoError(t, err)

	updated, err := repo.ListItems(ctx, poID)
	require.NoError(t, err)
	updatedShip := shippingLine(t, updated)
	require.NotNil(t, updatedShip.ShippingDays)
	assert.Equal(t, 12, *updatedShip.ShippingDays)
}

// Accept quotation carrying shipping, return PO.
func acceptedQuotationWithShipping(t *testing.T, tx pgx.Tx, days int) int64 {
	t.Helper()
	ctx := context.Background()
	qrepo := quotations.NewRepo(tx, testutil.Store(t))
	addr := "Tanjung Priok"
	cost := "75000"
	qid, err := qrepo.Create(ctx, quotations.CreateRequest{
		CompanyClientID: seedCompanyID,
		DiscountPct:     "0",
		ShippingAddress: &addr,
		ShippingDays:    &days,
		ShippingCost:    &cost,
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
	return po.ID
}

func shippingLine(t *testing.T, items []purchaseorders.PurchaseOrderItem) purchaseorders.PurchaseOrderItem {
	t.Helper()
	for _, it := range items {
		if it.ItemType == "shipping" {
			return it
		}
	}
	t.Fatal("no shipping line")
	return purchaseorders.PurchaseOrderItem{}
}

func int16Ptr(v int16) *int16 { return &v }
func strPtr(v string) *string { return &v }
