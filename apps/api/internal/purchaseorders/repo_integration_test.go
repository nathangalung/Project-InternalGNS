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
	rows, err := repo.List(ctx, nil, nil, 50, 0)
	require.NoError(t, err)
	assert.NotEmpty(t, rows)
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
		FileName: "po.pdf",
		FileSize: 1024,
		FileURL:  "data:application/pdf;base64,",
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
		FileName: "x.pdf", FileSize: 1, FileURL: "x",
	}, seedUserID)
	assert.ErrorIs(t, err, purchaseorders.ErrNotFound)
}
