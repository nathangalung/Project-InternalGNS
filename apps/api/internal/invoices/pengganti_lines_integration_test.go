package invoices_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// oneLine bills qty at 100000.
func oneLine(qty string) purchaseorders.UpdateItemsRequest {
	unit := seedUnitID
	address := "Jl. Pelabuhan 1, Jakarta"
	return purchaseorders.UpdateItemsRequest{
		DiscountPct: "0", ShippingAddress: &address,
		Items: []purchaseorders.UpdateItemsLine{{
			ItemName: "Test Product", Qty: qty, UnitID: &unit, SellingPrice: "100000",
		}},
	}
}

// No Rp 0 Pengganti.
// fn_create_invoice refuses a PO with no billable product line, whatever
// left its lines that way.
func TestReplace_RefusesZeroProductPO(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID, invID := deliveredPOWithInvoice(t, tx)
	repo := invoices.NewRepo(tx, testutil.Store(t))
	note := "Salah jumlah"
	require.NoError(t, repo.ChangeStatus(ctx, invID, invoices.ChangeStatusRequest{
		Status: invoices.StatusCancelled, Note: &note,
	}, seedUserID))
	_, err := tx.Exec(ctx, `
		UPDATE purchase_order_items SET qty = 0 WHERE po_id = $1 AND item_type = 'product'`, poID)
	require.NoError(t, err)

	_, err = repo.Replace(ctx, invID, seedUserID)
	require.Error(t, err)
	assert.Contains(t, err.Error(),
		"PO ini belum memiliki baris produk bernilai, sehingga invoice tidak dapat diterbitkan. Perbaiki melalui Ubah PO.")
}

// Pengganti bills corrected lines.
// Cancelling the invoice reopens Ubah PO, and the Pengganti issued after
// the edit bills the corrected quantity, not the cancelled amount.
func TestReplace_BillsCorrectedPoLines(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID, invID := deliveredPOWithInvoice(t, tx)
	store := testutil.Store(t)
	repo := invoices.NewRepo(tx, store)
	porepo := purchaseorders.NewRepo(tx, store)

	note := "Salah jumlah"
	require.NoError(t, repo.ChangeStatus(ctx, invID, invoices.ChangeStatusRequest{
		Status: invoices.StatusCancelled, Note: &note,
	}, seedUserID))
	_, err := porepo.UpdateItems(ctx, poID, oneLine("1"), seedUserID, nil)
	require.NoError(t, err)

	det, err := repo.Replace(ctx, invID, seedUserID)
	require.NoError(t, err)
	require.NotNil(t, det.Dpp)
	assert.Equal(t, "100000.00", *det.Dpp)

	// The live Pengganti locks the lines again.
	_, err = porepo.UpdateItems(ctx, poID, oneLine("5"), seedUserID, nil)
	require.ErrorIs(t, err, purchaseorders.ErrLocked)
}

// Pengganti serialises with Ubah PO.
// Whichever runs second waits on the PO row: an edit after the Pengganti
// is refused, and a Pengganti after the edit bills the edited lines.
func TestReplace_SerialisesWithPoEdit(t *testing.T) {
	ctx := context.Background()
	pool := testutil.Pool(t)
	store := testutil.Store(t)
	cleaner := testutil.NewCleaner(t)
	note := "Salah jumlah"
	cancelled := func(t *testing.T) (int64, int64) {
		t.Helper()
		poID, invID := committedInvoice(t, cleaner)
		require.NoError(t, invoices.NewRepo(pool, store).ChangeStatus(ctx, invID, invoices.ChangeStatusRequest{
			Status: invoices.StatusCancelled, Note: &note,
		}, seedUserID))
		return poID, invID
	}

	t.Run("a pengganti in flight refuses the edit", func(t *testing.T) {
		poID, invID := cancelled(t)

		tx, err := pool.Begin(ctx)
		require.NoError(t, err)
		defer func() { _ = tx.Rollback(ctx) }()
		_, err = invoices.NewRepo(tx, store).Replace(ctx, invID, seedUserID)
		require.NoError(t, err)

		done := make(chan error, 1)
		go func() {
			_, err := purchaseorders.NewRepo(pool, store).UpdateItems(ctx, poID, oneLine("1"), seedUserID, nil)
			done <- err
		}()
		select {
		case err := <-done:
			t.Fatalf("edit did not wait for the pengganti: %v", err)
		case <-time.After(raceWait):
		}
		require.NoError(t, tx.Commit(ctx))
		require.ErrorIs(t, <-done, purchaseorders.ErrLocked)
	})

	t.Run("an edit in flight is billed by the pengganti", func(t *testing.T) {
		poID, invID := cancelled(t)

		tx, err := pool.Begin(ctx)
		require.NoError(t, err)
		defer func() { _ = tx.Rollback(ctx) }()
		_, err = purchaseorders.NewRepo(tx, store).UpdateItems(ctx, poID, oneLine("1"), seedUserID, nil)
		require.NoError(t, err)

		type replaced struct {
			det invoices.InvoiceDetail
			err error
		}
		done := make(chan replaced, 1)
		go func() {
			det, err := invoices.NewRepo(pool, store).Replace(ctx, invID, seedUserID)
			done <- replaced{det, err}
		}()
		select {
		case r := <-done:
			t.Fatalf("pengganti did not wait for the edit: %v", r.err)
		case <-time.After(raceWait):
		}
		require.NoError(t, tx.Commit(ctx))
		r := <-done
		require.NoError(t, r.err)
		require.NotNil(t, r.det.Dpp)
		assert.Equal(t, "100000.00", *r.det.Dpp)
	})
}
