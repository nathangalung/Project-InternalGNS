package invoices_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// deliveredPOWithVessel populates header fields.
// Same walk as deliveredPOWithInvoice, plus a vessel and a client contact.
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
	attachPOFile(ctx, t, porepo, po.ID)
	require.NoError(t, porepo.ChangeStatus(ctx, po.ID, purchaseorders.StatusOnProgress, seedUserID))
	require.NoError(t, porepo.ChangeStatus(ctx, po.ID, purchaseorders.StatusDelivered, seedUserID))
	return qid, po.ID
}

// Detail carries every header field.
// The invoice page runs on finance credentials, which cannot read quotations
// or purchase orders.
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

	assert.Equal(t, invoices.AllowedTransitions(invoices.StatusDraft, true), det.AllowedTransitions)
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

// Terlambat is never offered.
// It is derived from the due date, so a sent invoice that is not yet due
// cannot be marked overdue by hand.
func TestAllowedTransitions_OmitOverdue(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)
	repo := invoices.NewRepo(tx, testutil.Store(t))

	require.NoError(t, repo.ChangeStatus(ctx, invID, move(invoices.StatusSent), seedUserID))
	assert.False(t, offers(invoices.StatusSent, invoices.StatusOverdue))
	assert.ErrorIs(t, repo.ChangeStatus(ctx, invID, move(invoices.StatusOverdue), seedUserID), invoices.ErrOverdueDerived)
}

// Fresh invoice history is [].
// Rows land only on a status change, so a new invoice has none, and the
// page iterates the field: it must serialize as [] rather than null.
func TestRepo_GetDetail_FreshInvoiceHasEmptyHistory(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)

	det, err := invoices.NewRepo(tx, testutil.Store(t)).GetDetail(ctx, invID)
	require.NoError(t, err)
	require.NotNil(t, det.History)
	assert.Empty(t, det.History)

	raw, err := json.Marshal(det)
	require.NoError(t, err)
	assert.Contains(t, string(raw), `"history":[]`)
}
