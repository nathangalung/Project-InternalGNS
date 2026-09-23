package invoices_test

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// A cancelled invoice is corrected by a Pengganti invoice for the same PO,
// with its own number and the same billed amounts.
func TestRepo_Replace_CancelledInvoice(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	qid, poID, oldID := deliveredPOWithInvoice(t, tx)
	repo := invoices.NewRepo(tx, testutil.Store(t))

	require.NoError(t, repo.ChangeStatus(ctx, oldID, invoices.StatusSent, seedUserID))
	require.NoError(t, repo.ChangeStatus(ctx, oldID, invoices.StatusCancelled, seedUserID))
	old, err := repo.GetDetail(ctx, oldID)
	require.NoError(t, err)

	det, err := repo.Replace(ctx, oldID, seedUserID)
	require.NoError(t, err)

	assert.NotEqual(t, oldID, det.ID)
	assert.NotEqual(t, old.InvoiceNo, det.InvoiceNo)
	require.NotNil(t, det.PoID)
	assert.Equal(t, poID, *det.PoID)
	assert.Equal(t, invoices.StatusDraft, det.Status)
	require.NotNil(t, det.FakturType)
	assert.Equal(t, "Pengganti", *det.FakturType)
	require.NotNil(t, det.ReplacesInvoiceID)
	assert.Equal(t, oldID, *det.ReplacesInvoiceID)
	require.NotNil(t, det.ReplacesInvoiceNo)
	assert.Equal(t, old.InvoiceNo, *det.ReplacesInvoiceNo)
	assert.Equal(t, old.Dpp, det.Dpp)
	assert.Equal(t, old.PpnAmount, det.PpnAmount)
	assert.Equal(t, old.Total, det.Total)

	// The screen routes on the quotation, so it now opens the replacement.
	byQuotation, err := repo.GetDetailByQuotation(ctx, qid)
	require.NoError(t, err)
	assert.Equal(t, det.ID, byQuotation.ID)

	// The cancelled original records who replaced it and stays cancelled.
	after, err := repo.GetDetail(ctx, oldID)
	require.NoError(t, err)
	assert.Equal(t, invoices.StatusCancelled, after.Status)
	require.NotNil(t, after.ReplacedByInvoiceID)
	assert.Equal(t, det.ID, *after.ReplacedByInvoiceID)
}

// Only a cancelled, not yet replaced invoice can be replaced.
func TestRepo_Replace_Refusals(t *testing.T) {
	cases := []struct {
		name     string
		path     []invoices.Status
		replaced bool
		wantCode string
	}{
		{name: "draft is refused", wantCode: "P0012"},
		{name: "sent is refused", path: []invoices.Status{invoices.StatusSent}, wantCode: "P0012"},
		{name: "paid is refused", path: []invoices.Status{invoices.StatusSent, invoices.StatusPaid}, wantCode: "P0012"},
		{name: "replaced twice is refused", path: []invoices.Status{invoices.StatusCancelled}, replaced: true, wantCode: "P0013"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			_, _, invID := deliveredPOWithInvoice(t, tx)
			repo := invoices.NewRepo(tx, testutil.Store(t))

			for _, target := range tc.path {
				require.NoError(t, repo.ChangeStatus(ctx, invID, target, seedUserID))
			}
			if tc.replaced {
				_, err := repo.Replace(ctx, invID, seedUserID)
				require.NoError(t, err)
			}

			_, err := repo.Replace(ctx, invID, seedUserID)
			var pgErr *pgconn.PgError
			require.True(t, errors.As(err, &pgErr), "want a raised SQLSTATE, got %v", err)
			assert.Equal(t, tc.wantCode, pgErr.Code)
		})
	}
}

func TestRepo_Replace_NotFound(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := invoices.NewRepo(tx, testutil.Store(t))

	_, err := repo.Replace(ctx, 99999999, seedUserID)
	assert.ErrorIs(t, err, invoices.ErrNotFound)
}

// One live invoice per PO stays a schema invariant; cancelled ones do not count.
func TestSchema_OneLiveInvoicePerPO(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID, invID := deliveredPOWithInvoice(t, tx)

	_, err := tx.Exec(ctx, `SAVEPOINT dup`)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `
		INSERT INTO invoices (invoice_no, quotation_id, po_id, company_client_id, invoice_date, status, created_by, updated_by)
		SELECT 'INV-DUP-LIVE', quotation_id, po_id, company_client_id, invoice_date, 'draft', 1, 1
		  FROM invoices WHERE id = $1`, invID)
	var pgErr *pgconn.PgError
	require.True(t, errors.As(err, &pgErr), "second live invoice must be refused, got %v", err)
	assert.Equal(t, "23505", pgErr.Code)
	_, err = tx.Exec(ctx, `ROLLBACK TO SAVEPOINT dup`)
	require.NoError(t, err)

	// fn_create_invoice stays idempotent for the live invoice.
	var again int64
	require.NoError(t, tx.QueryRow(ctx, `SELECT fn_create_invoice($1, 1)`, poID).Scan(&again))
	assert.Equal(t, invID, again)
}
