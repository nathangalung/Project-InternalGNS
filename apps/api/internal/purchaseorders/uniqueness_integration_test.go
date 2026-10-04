package purchaseorders_test

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const secondCompanyID int64 = 2

func poDateFixture() time.Time {
	return time.Date(2026, time.January, 15, 0, 0, 0, 0, time.UTC)
}

// Accept a client quotation.
// It returns the created PO.
func acceptedQuotationForCompany(t *testing.T, tx pgx.Tx, companyID int64) int64 {
	t.Helper()
	ctx := context.Background()
	qrepo := quotations.NewRepo(tx, testutil.Store(t))
	qid, err := qrepo.Create(ctx, quotations.CreateRequest{
		ValidityDays:    testutil.Validity(),
		CompanyClientID: companyID,
		DiscountPct:     "0",
		Items: testutil.OfferLines(t, ctx, tx, []quotations.CreateItem{{
			RequestedName:   "Test Product",
			Qty:             "2",
			UnitID:          seedUnitID,
			SellingPrice:    "100000",
			ShipDestination: strPtr("Kapal Uji"),
		}}),
	}, seedUserID)
	require.NoError(t, err)
	require.NoError(t, qrepo.ChangeStatus(ctx, qid, "sent", nil, seedUserID))
	require.NoError(t, qrepo.ChangeStatus(ctx, qid, "accepted", nil, seedUserID))

	po, err := purchaseorders.NewRepo(tx, testutil.Store(t)).GetByQuotation(ctx, qid)
	require.NoError(t, err)
	testutil.EnterPONumber(t, ctx, tx, po.ID)
	return po.ID
}

// One PO per quotation.
// The database enforces it.
func TestPurchaseOrders_QuotationIsUnique(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	qID, _ := acceptedQuotationWithPO(t, tx)

	_, err := tx.Exec(ctx, `
		INSERT INTO purchase_orders
		  (po_number, quotation_id, company_client_id, po_date, status, created_by, updated_by)
		VALUES ('PO-DUPLICATE-QUOTATION', $1, $2, CURRENT_DATE, 'PENDING', $3, $3)`,
		qID, seedCompanyID, seedUserID)
	require.Error(t, err)

	var pgErr *pgconn.PgError
	require.ErrorAs(t, err, &pgErr)
	assert.Equal(t, "23505", pgErr.Code)
	assert.Equal(t, "uq_purchase_orders_quotation_id", pgErr.ConstraintName)
}

// Client PO numbers are per-client.
// They are unique per client, not globally.
func TestPurchaseOrders_ClientPoNumberScopedToClient(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID := acceptedQuotationWithPO(t, tx)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))

	const shared = "PO/CLIENT/0001"
	require.NoError(t, repo.UpdateDetails(ctx, poID, shared, poDateFixture(), seedUserID, nil))

	otherPoID := acceptedQuotationForCompany(t, tx, secondCompanyID)
	require.NoError(t, repo.UpdateDetails(ctx, otherPoID, shared, poDateFixture(), seedUserID, nil))

	_, samePoID := acceptedQuotationWithPO(t, tx)
	err := repo.UpdateDetails(ctx, samePoID, shared, poDateFixture(), seedUserID, nil)
	assert.ErrorIs(t, err, purchaseorders.ErrDuplicatePoNumber)
}

// Case variants are one number.
func TestPurchaseOrders_ClientPoNumberIgnoresCase(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, first := acceptedQuotationWithPO(t, tx)
	_, second := acceptedQuotationWithPO(t, tx)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	require.NoError(t, repo.UpdateDetails(ctx, first, "PO/Klien/0007", poDateFixture(), seedUserID, nil))

	// A savepoint keeps the refusal from aborting the test tx.
	sp, err := tx.Begin(ctx)
	require.NoError(t, err)
	err = purchaseorders.NewRepo(sp, testutil.Store(t)).
		UpdateDetails(ctx, second, "  po/klien/0007 ", poDateFixture(), seedUserID, nil)
	assert.ErrorIs(t, err, purchaseorders.ErrDuplicatePoNumber)
	require.NoError(t, sp.Rollback(ctx))
}

// Cancelling frees the number.
// The order that replaces a cancelled PO carries the same client number.
func TestPurchaseOrders_ClientPoNumberReusedAfterCancel(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, cancelled := acceptedQuotationWithPO(t, tx)
	_, next := acceptedQuotationWithPO(t, tx)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	const number = "PO/KLIEN/ULANG"
	require.NoError(t, repo.UpdateDetails(ctx, cancelled, number, poDateFixture(), seedUserID, nil))
	require.NoError(t, repo.Transition(ctx, cancelled, purchaseorders.StatusCancelled, "Pesanan diganti", seedUserID))

	require.NoError(t, repo.UpdateDetails(ctx, next, number, poDateFixture(), seedUserID, nil))
	po, err := repo.GetByID(ctx, next)
	require.NoError(t, err)
	require.NotNil(t, po.PoNumber)
	assert.Equal(t, number, *po.PoNumber)
}
