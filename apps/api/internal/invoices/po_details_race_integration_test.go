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

// raceWait bounds a blocked call.
const raceWait = 300 * time.Millisecond

// committedInvoice delivers a committed PO.
// It returns the PO and invoice ids; the cleaner deletes them.
func committedInvoice(t *testing.T, cleaner *testutil.Cleaner) (int64, int64) {
	t.Helper()
	ctx := context.Background()
	tx, err := testutil.Pool(t).Begin(ctx)
	require.NoError(t, err)
	defer func() { _ = tx.Rollback(ctx) }()
	qid, poID, invID := deliveredPOWithInvoice(t, tx)
	require.NoError(t, tx.Commit(ctx))
	cleaner.Quotation(qid)
	return poID, invID
}

// Sending serialises with PO details.
// The invoice never goes out with a PO number it does not show: whichever
// of the two saves runs second waits for the first and sees its result.
func TestSend_SerialisesWithPoDetails(t *testing.T) {
	ctx := context.Background()
	pool := testutil.Pool(t)
	store := testutil.Store(t)
	cleaner := testutil.NewCleaner(t)

	t.Run("a details change in flight holds the send", func(t *testing.T) {
		poID, invID := committedInvoice(t, cleaner)

		tx, err := pool.Begin(ctx)
		require.NoError(t, err)
		defer func() { _ = tx.Rollback(ctx) }()
		require.NoError(t, purchaseorders.NewRepo(tx, store).UpdateDetails(
			ctx, poID, "PO-RACE-CHANGED", time.Now(), seedUserID, nil))

		done := make(chan error, 1)
		go func() {
			done <- invoices.NewRepo(pool, store).ChangeStatus(ctx, invID, move(invoices.StatusSent), seedUserID)
		}()
		select {
		case err := <-done:
			t.Fatalf("send did not wait for the PO details change: %v", err)
		case <-time.After(raceWait):
		}
		require.NoError(t, tx.Commit(ctx))
		require.NoError(t, <-done)

		det, err := invoices.NewRepo(pool, store).GetDetail(ctx, invID)
		require.NoError(t, err)
		assert.Equal(t, invoices.StatusSent, det.Status)
		require.NotNil(t, det.PoNumber)
		assert.Equal(t, "PO-RACE-CHANGED", *det.PoNumber)
	})

	t.Run("a send in flight refuses the details change", func(t *testing.T) {
		poID, invID := committedInvoice(t, cleaner)

		tx, err := pool.Begin(ctx)
		require.NoError(t, err)
		defer func() { _ = tx.Rollback(ctx) }()
		require.NoError(t, invoices.NewRepo(tx, store).ChangeStatus(ctx, invID, move(invoices.StatusSent), seedUserID))

		done := make(chan error, 1)
		go func() {
			done <- purchaseorders.NewRepo(pool, store).UpdateDetails(
				ctx, poID, "PO-RACE-LATE", time.Now(), seedUserID, nil)
		}()
		select {
		case err := <-done:
			t.Fatalf("details change did not wait for the send: %v", err)
		case <-time.After(raceWait):
		}
		require.NoError(t, tx.Commit(ctx))
		require.ErrorIs(t, <-done, purchaseorders.ErrLocked)

		det, err := invoices.NewRepo(pool, store).GetDetail(ctx, invID)
		require.NoError(t, err)
		require.NotNil(t, det.PoNumber)
		assert.NotEqual(t, "PO-RACE-LATE", *det.PoNumber)
	})
}
