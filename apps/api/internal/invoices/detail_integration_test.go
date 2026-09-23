package invoices_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Same walk as deliveredPOWithInvoice, with a vessel and a client contact so
// the header fields under test are populated.
func deliveredPOWithVessel(t *testing.T, tx pgx.Tx) (int64, int64) {
	t.Helper()
	ctx := context.Background()
	store := testutil.Store(t)
	vessel := "MV Test Vessel"
	contactID := int64(1)

	qrepo := quotations.NewRepo(tx, store)
	qid, err := qrepo.Create(ctx, quotations.CreateRequest{
		CompanyClientID: seedCompanyID,
		ContactID:       &contactID,
		VesselName:      &vessel,
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

	porepo := purchaseorders.NewRepo(tx, store)
	po, err := porepo.GetByQuotation(ctx, qid)
	require.NoError(t, err)
	require.NoError(t, porepo.ChangeStatus(ctx, po.ID, purchaseorders.StatusUploaded, seedUserID))
	require.NoError(t, porepo.ChangeStatus(ctx, po.ID, purchaseorders.StatusOnProgress, seedUserID))
	require.NoError(t, porepo.ChangeStatus(ctx, po.ID, purchaseorders.StatusDelivered, seedUserID))
	return qid, po.ID
}

// The invoice page runs on finance credentials, which cannot read quotations
// or purchase orders, so every header field it prints comes from here.
func TestRepo_GetDetailByQuotation_CarriesClientAndPoHeader(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	qid, poID := deliveredPOWithVessel(t, tx)

	repo := invoices.NewRepo(tx, testutil.Store(t))
	det, err := repo.GetDetailByQuotation(ctx, qid)
	require.NoError(t, err)

	assert.Equal(t, qid, det.QuotationID)
	assert.NotEmpty(t, det.QuotationNo)
	assert.NotEmpty(t, det.CompanyName)

	require.NotNil(t, det.VesselName)
	assert.Equal(t, "MV Test Vessel", *det.VesselName)

	require.NotNil(t, det.CompanyNpwp)
	assert.NotEmpty(t, *det.CompanyNpwp)
	require.NotNil(t, det.CompanyAddress)
	assert.NotEmpty(t, *det.CompanyAddress)
	assert.Equal(t, "IDN", det.CompanyCountryCode)
	require.NotNil(t, det.ContactName)
	assert.NotEmpty(t, *det.ContactName)

	require.NotNil(t, det.PoID)
	assert.Equal(t, poID, *det.PoID)
	require.NotNil(t, det.PoNumber)
	assert.NotEmpty(t, *det.PoNumber)
	require.NotNil(t, det.PoDate)

	assert.Equal(t, invoices.AllowedTransitions(invoices.StatusDraft), det.AllowedStatuses)
}

func TestRepo_GetDetail_MatchesGetDetailByQuotation(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	qid, _ := deliveredPOWithVessel(t, tx)

	repo := invoices.NewRepo(tx, testutil.Store(t))
	byQuotation, err := repo.GetDetailByQuotation(ctx, qid)
	require.NoError(t, err)
	byID, err := repo.GetDetail(ctx, byQuotation.ID)
	require.NoError(t, err)
	assert.Equal(t, byQuotation, byID)
}

func TestRepo_GetDetail_NotFound(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := invoices.NewRepo(tx, testutil.Store(t))

	_, err := repo.GetDetail(ctx, 99999999)
	assert.ErrorIs(t, err, invoices.ErrNotFound)
}

// Every exposed transition is one fn_change_invoice_status accepts.
func TestAllowedTransitions_AreAcceptedByTheDatabase(t *testing.T) {
	for _, from := range []invoices.Status{invoices.StatusDraft, invoices.StatusSent} {
		for _, target := range invoices.AllowedTransitions(from) {
			t.Run(string(from)+"-"+string(target), func(t *testing.T) {
				ctx, tx := testutil.BeginTx(t)
				_, _, invID := deliveredPOWithInvoice(t, tx)
				repo := invoices.NewRepo(tx, testutil.Store(t))

				if from != invoices.StatusDraft {
					require.NoError(t, repo.ChangeStatus(ctx, invID, from, seedUserID))
				}
				require.NoError(t, repo.ChangeStatus(ctx, invID, target, seedUserID))

				inv, err := repo.GetByID(ctx, invID)
				require.NoError(t, err)
				assert.Equal(t, target, inv.Status)
			})
		}
	}
}

// Terlambat is derived from the due date, so it is never offered and a
// sent invoice that is not yet due cannot be marked overdue by hand.
func TestAllowedTransitions_OmitOverdue(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)
	repo := invoices.NewRepo(tx, testutil.Store(t))

	require.NoError(t, repo.ChangeStatus(ctx, invID, invoices.StatusSent, seedUserID))
	assert.NotContains(t, invoices.AllowedTransitions(invoices.StatusSent), invoices.StatusOverdue)
	assert.ErrorIs(t, repo.ChangeStatus(ctx, invID, invoices.StatusOverdue, seedUserID), invoices.ErrOverdueDerived)
}
