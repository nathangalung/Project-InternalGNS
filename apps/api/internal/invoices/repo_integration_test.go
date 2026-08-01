package invoices_test

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const (
	seedUserID    int64 = 1
	seedCompanyID int64 = 1
	seedUnitID    int16 = 19
)

// Drive quotation to delivered PO.
func deliveredPOWithInvoice(t *testing.T, tx pgx.Tx) (int64, int64, int64) {
	t.Helper()
	ctx := context.Background()
	store := testutil.Store(t)

	qrepo := quotations.NewRepo(tx, store)
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

	porepo := purchaseorders.NewRepo(tx, store)
	po, err := porepo.GetByQuotation(ctx, qid)
	require.NoError(t, err)
	require.NoError(t, porepo.ChangeStatus(ctx, po.ID, purchaseorders.StatusUploaded, seedUserID))
	require.NoError(t, porepo.ChangeStatus(ctx, po.ID, purchaseorders.StatusOnProgress, seedUserID))
	require.NoError(t, porepo.ChangeStatus(ctx, po.ID, purchaseorders.StatusDelivered, seedUserID))

	repo := invoices.NewRepo(tx, store)
	inv, err := repo.GetByQuotation(ctx, qid)
	require.NoError(t, err)
	return qid, po.ID, inv.ID
}

func TestRepo_GetByQuotation(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	qid, _, invID := deliveredPOWithInvoice(t, tx)

	repo := invoices.NewRepo(tx, testutil.Store(t))
	inv, err := repo.GetByQuotation(ctx, qid)
	require.NoError(t, err)
	assert.Equal(t, invID, inv.ID)
	assert.Equal(t, invoices.StatusDraft, inv.Status)
	assert.NotEmpty(t, inv.InvoiceNo)
}

func TestRepo_GetByID(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)

	repo := invoices.NewRepo(tx, testutil.Store(t))
	inv, err := repo.GetByID(ctx, invID)
	require.NoError(t, err)
	assert.Equal(t, invID, inv.ID)
}

func TestRepo_GetByID_NotFound(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := invoices.NewRepo(tx, testutil.Store(t))

	_, err := repo.GetByID(ctx, 99999999)
	assert.ErrorIs(t, err, invoices.ErrNotFound)
}

func TestRepo_List(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	deliveredPOWithInvoice(t, tx)

	repo := invoices.NewRepo(tx, testutil.Store(t))
	res, err := repo.List(ctx, invoices.ListFilter{Limit: 50})
	require.NoError(t, err)
	assert.NotEmpty(t, res.Rows)
	assert.GreaterOrEqual(t, res.Total, int64(1))
}

// DPP equals subtotal, total math.
func TestRepo_InvoiceMoneyMath(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)

	repo := invoices.NewRepo(tx, testutil.Store(t))
	inv, err := repo.GetByID(ctx, invID)
	require.NoError(t, err)

	require.NotNil(t, inv.Subtotal)
	require.NotNil(t, inv.Dpp)
	require.NotNil(t, inv.Total)
	require.NotNil(t, inv.PpnAmount)

	// Subtotal equals dpp by design.
	assert.Equal(t, *inv.Subtotal, *inv.Dpp)

	dpp, err := strconv.ParseFloat(*inv.Dpp, 64)
	require.NoError(t, err)
	total, err := strconv.ParseFloat(*inv.Total, 64)
	require.NoError(t, err)
	ppn, err := strconv.ParseFloat(*inv.PpnAmount, 64)
	require.NoError(t, err)

	// total equals dpp times 1.11.
	assert.InDelta(t, dpp*1.11, total, 0.01)

	// ppn equals 11% of dpp.
	assert.InDelta(t, dpp*0.11, ppn, 0.01)
}

func parseF(t *testing.T, s *string) float64 {
	t.Helper()
	require.NotNil(t, s)
	v, err := strconv.ParseFloat(*s, 64)
	require.NoError(t, err)
	return v
}

// Header tax equals the sum of the per-line rounded values (matches the DJP
// e-faktur filing), not ROUND of the summed base.
func TestRepo_InvoiceHeaderEqualsLineSums(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	store := testutil.Store(t)

	// Two lines of 100000: each line's dpp_nilai_lain rounds to 91666.67,
	// summing to 183333.34, whereas ROUND(200000*11/12) is 183333.33.
	qrepo := quotations.NewRepo(tx, store)
	qid, err := qrepo.Create(ctx, quotations.CreateRequest{
		CompanyClientID: seedCompanyID,
		DiscountPct:     "0",
		Items: []quotations.CreateItem{
			{RequestedName: "Product A", Qty: "1", UnitID: seedUnitID, SellingPrice: "100000"},
			{RequestedName: "Product B", Qty: "1", UnitID: seedUnitID, SellingPrice: "100000"},
		},
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

	repo := invoices.NewRepo(tx, store)
	inv, err := repo.GetByQuotation(ctx, qid)
	require.NoError(t, err)
	items, err := repo.ListItems(ctx, inv.ID)
	require.NoError(t, err)
	require.GreaterOrEqual(t, len(items), 2)

	var sumDnl, sumPpn float64
	for _, it := range items {
		sumDnl += parseF(t, it.DppNilaiLain)
		sumPpn += parseF(t, it.PpnAmount)
	}
	// Header must equal the per-line sums exactly.
	assert.InDelta(t, sumDnl, parseF(t, inv.DppNilaiLain), 0.001)
	assert.InDelta(t, sumPpn, parseF(t, inv.PpnAmount), 0.001)
	// Grand total is dpp plus the summed ppn.
	assert.InDelta(t, parseF(t, inv.Dpp)+sumPpn, parseF(t, inv.Total), 0.001)
}

func TestRepo_ChangeStatus_Lifecycle(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)

	repo := invoices.NewRepo(tx, testutil.Store(t))
	require.NoError(t, repo.ChangeStatus(ctx, invID, invoices.StatusSent, seedUserID))
	require.NoError(t, repo.ChangeStatus(ctx, invID, invoices.StatusPaid, seedUserID))

	inv, err := repo.GetByID(ctx, invID)
	require.NoError(t, err)
	assert.Equal(t, invoices.StatusPaid, inv.Status)
}

func TestRepo_ChangeStatus_NotFound(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := invoices.NewRepo(tx, testutil.Store(t))
	err := repo.ChangeStatus(ctx, 99999999, invoices.StatusSent, seedUserID)
	assert.ErrorIs(t, err, invoices.ErrNotFound)
}

func TestRepo_UpdateDates_VersionMatch(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)

	repo := invoices.NewRepo(tx, testutil.Store(t))
	before, err := repo.GetByID(ctx, invID)
	require.NoError(t, err)

	due := before.InvoiceDate.AddDate(0, 0, 14)
	v := before.RowVersion
	newVersion, err := repo.UpdateDates(ctx, invID, invoices.UpdateDatesRequest{DueDate: &due}, seedUserID, &v)
	require.NoError(t, err)
	assert.Greater(t, newVersion, before.RowVersion)

	after, err := repo.GetByID(ctx, invID)
	require.NoError(t, err)
	require.NotNil(t, after.DueDate)
	assert.WithinDuration(t, due, *after.DueDate, 0)
	assert.Equal(t, newVersion, after.RowVersion)
}

func TestRepo_UpdateDates_VersionMismatch(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)

	repo := invoices.NewRepo(tx, testutil.Store(t))
	stale := int32(999)
	_, err := repo.UpdateDates(ctx, invID, invoices.UpdateDatesRequest{}, seedUserID, &stale)
	assert.ErrorIs(t, err, invoices.ErrVersionMismatch)
}

func TestRepo_UpdateDates_NotFound(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := invoices.NewRepo(tx, testutil.Store(t))

	_, err := repo.UpdateDates(ctx, 99999999, invoices.UpdateDatesRequest{}, seedUserID, nil)
	assert.ErrorIs(t, err, invoices.ErrNotFound)
}

func TestRepo_UpdateDates_NoIfMatchSkipsGuard(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)

	repo := invoices.NewRepo(tx, testutil.Store(t))
	due := time.Now().AddDate(0, 0, 7)
	newVersion, err := repo.UpdateDates(ctx, invID, invoices.UpdateDatesRequest{DueDate: &due}, seedUserID, nil)
	require.NoError(t, err)
	assert.Greater(t, newVersion, int32(0))
}

// Clone an invoice line under a new line number.
func addInvoiceLine(t *testing.T, ctx context.Context, tx pgx.Tx, invID int64, lineNumber *int16) {
	t.Helper()
	_, err := tx.Exec(ctx, `
INSERT INTO invoice_items (
    invoice_id, quotation_item_id, line_number, line_type, item_name, item_code,
    goods_or_service, offered_item_id, unit_id, unit_code, qty, unit_price,
    gross_unit_price, cost_price, dpp, dpp_nilai_lain, ppn_rate, ppn_amount,
    ship_destination, created_by)
SELECT invoice_id, quotation_item_id, $2, line_type, item_name, item_code,
       goods_or_service, offered_item_id, unit_id, unit_code, qty, unit_price,
       gross_unit_price, cost_price, dpp, dpp_nilai_lain, ppn_rate, ppn_amount,
       ship_destination, created_by
FROM invoice_items WHERE invoice_id = $1 ORDER BY id LIMIT 1`, invID, lineNumber)
	require.NoError(t, err)
}

// Bulk grouping equals N ListItems calls.
func TestRepo_ListItemsBulk_MatchesListItems(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, invA := deliveredPOWithInvoice(t, tx)
	_, _, invB := deliveredPOWithInvoice(t, tx)
	require.NotEqual(t, invA, invB)

	// A NULL line number must sort as 0 (first), not last, and invoice A must
	// carry several lines so within-invoice ordering is actually exercised.
	high := int16(9)
	addInvoiceLine(t, ctx, tx, invA, &high)
	addInvoiceLine(t, ctx, tx, invA, nil)

	repo := invoices.NewRepo(tx, testutil.Store(t))
	const noItems int64 = 99999999
	ids := []int64{invA, invB, noItems}

	bulk, err := repo.ListItemsBulk(ctx, ids)
	require.NoError(t, err)

	want := map[int64][]invoices.InvoiceItem{}
	for _, id := range ids {
		items, err := repo.ListItems(ctx, id)
		require.NoError(t, err)
		if len(items) == 0 {
			continue
		}
		want[id] = items
	}
	require.Len(t, want[invA], 3)
	require.Nil(t, want[noItems])
	assert.Equal(t, want, bulk)
	// An id with no lines is absent, not present with an empty slice: the
	// coretax export keys its skip on exactly that.
	_, present := bulk[noItems]
	assert.False(t, present)
}

func TestRepo_ListItemsBulk_EmptyIDs(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := invoices.NewRepo(tx, testutil.Store(t))

	got, err := repo.ListItemsBulk(ctx, nil)
	require.NoError(t, err)
	assert.NotNil(t, got)
	assert.Empty(t, got)
}

func TestRepo_Summary(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	deliveredPOWithInvoice(t, tx)

	repo := invoices.NewRepo(tx, testutil.Store(t))
	s, err := repo.Summary(ctx)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, s.Total, int64(1))
	assert.GreaterOrEqual(t, s.Draft, int64(0))
	assert.GreaterOrEqual(t, s.Sent, int64(0))
	assert.GreaterOrEqual(t, s.Paid, int64(0))
	assert.GreaterOrEqual(t, s.Overdue, int64(0))
	assert.Equal(t, s.Total, s.Draft+s.Sent+s.Paid+s.Overdue)
}
