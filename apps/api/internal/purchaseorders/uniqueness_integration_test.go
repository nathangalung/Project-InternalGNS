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
		CompanyClientID: companyID,
		DiscountPct:     "0",
		Items: []quotations.CreateItem{{
			RequestedName:   "Test Product",
			Qty:             "2",
			UnitID:          seedUnitID,
			SellingPrice:    "100000",
			ShipDestination: strPtr("Kapal Uji"),
		}},
	}, seedUserID)
	require.NoError(t, err)
	require.NoError(t, qrepo.ChangeStatus(ctx, qid, "sent", nil, seedUserID))
	require.NoError(t, qrepo.ChangeStatus(ctx, qid, "accepted", nil, seedUserID))

	po, err := purchaseorders.NewRepo(tx, testutil.Store(t)).GetByQuotation(ctx, qid)
	require.NoError(t, err)
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
