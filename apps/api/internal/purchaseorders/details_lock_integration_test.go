package purchaseorders_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Deliver a PO, creating invoice.
func deliveredPO(t *testing.T, tx pgx.Tx) (int64, int64) {
	t.Helper()
	ctx := context.Background()
	qID, poID := acceptedQuotationWithPO(t, tx)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	require.NoError(t, repo.UpdateFile(ctx, poID, testPOFile, seedUserID))
	require.NoError(t, repo.ChangeStatus(ctx, poID, purchaseorders.StatusOnProgress, seedUserID))
	require.NoError(t, repo.ChangeStatus(ctx, poID, purchaseorders.StatusDelivered, seedUserID))
	return qID, poID
}

func setInvoiceStatus(t *testing.T, tx pgx.Tx, qID int64, status string) {
	t.Helper()
	_, err := tx.Exec(context.Background(),
		`UPDATE invoices SET status = $2 WHERE quotation_id = $1`, qID, status)
	require.NoError(t, err)
}

// Filed invoice locks PO details.
// PO-04: po_number and po_date are read-only once the invoice is filed.
func TestRepo_UpdateDetails_InvoiceStatusLock(t *testing.T) {
	cases := []struct {
		name          string
		invoiceStatus string
		wantLocked    bool
	}{
		{name: "draft invoice still editable", invoiceStatus: "draft"},
		{name: "sent invoice locks details", invoiceStatus: "sent", wantLocked: true},
		{name: "paid invoice locks details", invoiceStatus: "paid", wantLocked: true},
		{name: "overdue invoice locks details", invoiceStatus: "overdue", wantLocked: true},
		{name: "cancelled invoice releases details", invoiceStatus: "cancelled"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			qID, poID := deliveredPO(t, tx)
			setInvoiceStatus(t, tx, qID, tc.invoiceStatus)

			repo := purchaseorders.NewRepo(tx, testutil.Store(t))
			err := repo.UpdateDetails(ctx, poID, "PO/CLIENT/9", poDateFixture(), seedUserID, nil)
			if tc.wantLocked {
				require.Error(t, err)
				assert.ErrorIs(t, err, purchaseorders.ErrLocked)
				return
			}
			require.NoError(t, err)
		})
	}
}

// If-Match guards details edits.
// A lost update is refused.
func TestRepo_UpdateDetails_IfMatch(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID := acceptedQuotationWithPO(t, tx)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))

	po, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	current := po.RowVersion

	require.NoError(t, repo.UpdateDetails(ctx, poID, "PO/CLIENT/1", poDateFixture(), seedUserID, &current))

	// The same version is now stale.
	err = repo.UpdateDetails(ctx, poID, "PO/CLIENT/2", poDateFixture(), seedUserID, &current)
	assert.ErrorIs(t, err, purchaseorders.ErrVersionMismatch)
}

func TestRepo_UpdateDetails_NotFound(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))

	err := repo.UpdateDetails(ctx, 99999999, "PO/X", poDateFixture(), seedUserID, nil)
	assert.ErrorIs(t, err, purchaseorders.ErrNotFound)
}

// If-Match guards notes edits.
// A lost update is refused.
func TestRepo_UpdateNotes_IfMatch(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID := acceptedQuotationWithPO(t, tx)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))

	po, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	current := po.RowVersion

	require.NoError(t, repo.UpdateNotes(ctx, poID, "first", seedUserID, &current))

	got, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	require.NotNil(t, got.Notes)
	assert.Equal(t, "first", *got.Notes)

	// The raise aborts the surrounding transaction, so it comes last.
	err = repo.UpdateNotes(ctx, poID, "second", seedUserID, &current)
	assert.ErrorIs(t, err, purchaseorders.ErrVersionMismatch)
}

func TestRepo_UpdateNotes_NotFound(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))

	err := repo.UpdateNotes(ctx, 99999999, "x", seedUserID, nil)
	assert.ErrorIs(t, err, purchaseorders.ErrNotFound)
}
