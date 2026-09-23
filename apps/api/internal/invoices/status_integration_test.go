package invoices_test

import (
	"errors"
	"strconv"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// move adds a required reason.
func move(s invoices.Status) invoices.ChangeStatusRequest {
	req := invoices.ChangeStatusRequest{Status: s}
	if s == invoices.StatusCancelled {
		note := "Dibatalkan oleh uji otomatis"
		req.Note = &note
	}
	return req
}

func sqlState(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code
	}
	return ""
}

func offers(from, to invoices.Status) bool {
	for _, m := range invoices.Transitions[from] {
		if m.To == to {
			return true
		}
	}
	return false
}

// Go map mirrors the database.
// Every pair fn_change_invoice_status accepts is offered, and every pair
// it refuses is not.
func TestTransitions_MirrorTheDatabase(t *testing.T) {
	for _, from := range invoices.StatusOrder {
		for _, to := range invoices.StatusOrder {
			if from == to {
				continue
			}
			t.Run(string(from)+"-"+string(to), func(t *testing.T) {
				ctx, tx := testutil.BeginTx(t)
				_, _, invID := deliveredPOWithInvoice(t, tx)
				_, err := tx.Exec(ctx, `UPDATE invoices SET status = $2 WHERE id = $1`, invID, string(from))
				require.NoError(t, err)

				_, err = tx.Exec(ctx, `SELECT fn_change_invoice_status($1, $2, $3, $4, NULL)`,
					invID, string(to), seedUserID, "alasan uji")
				if offers(from, to) {
					require.NoError(t, err)
					return
				}
				require.Error(t, err)
				assert.Equal(t, "P0012", sqlState(err), err.Error())
			})
		}
	}
}

func TestChangeStatus_CancelRequiresNote(t *testing.T) {
	blank := "   "
	cases := []struct {
		name string
		note *string
	}{
		{name: "no note", note: nil},
		{name: "blank note", note: &blank},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			_, _, invID := deliveredPOWithInvoice(t, tx)
			repo := invoices.NewRepo(tx, testutil.Store(t))

			err := repo.ChangeStatus(ctx, invID, invoices.ChangeStatusRequest{
				Status: invoices.StatusCancelled, Note: tc.note,
			}, seedUserID)
			require.Error(t, err)
			assert.Equal(t, "P0014", sqlState(err))
			assert.Contains(t, err.Error(), "Alasan pembatalan invoice wajib diisi.")
		})
	}
}

// Cancelling needs a PO.
// Without one no Pengganti can follow, so a cancel is a dead end.
func TestChangeStatus_CancelRequiresPO(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)
	_, err := tx.Exec(ctx, `UPDATE invoices SET po_id = NULL WHERE id = $1`, invID)
	require.NoError(t, err)
	repo := invoices.NewRepo(tx, testutil.Store(t))

	det, err := repo.GetDetail(ctx, invID)
	require.NoError(t, err)
	assert.Equal(t, []invoices.Transition{{To: invoices.StatusSent, Label: "Dikirim"}}, det.AllowedTransitions)

	err = repo.ChangeStatus(ctx, invID, move(invoices.StatusCancelled), seedUserID)
	require.Error(t, err)
	assert.Equal(t, "P0012", sqlState(err))
}

func TestChangeStatus_PaidRecordsPaymentAndHistory(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)
	repo := invoices.NewRepo(tx, testutil.Store(t))
	proof := "invoices/" + strconv.FormatInt(invID, 10) + "/1700000000-bukti.pdf"

	require.NoError(t, repo.ChangeStatus(ctx, invID, move(invoices.StatusSent), seedUserID))
	require.NoError(t, repo.ChangeStatus(ctx, invID, invoices.ChangeStatusRequest{
		Status: invoices.StatusPaid, PaymentProofKey: &proof,
	}, seedUserID))

	det, err := repo.GetDetail(ctx, invID)
	require.NoError(t, err)
	require.NotNil(t, det.PaidAt)
	require.NotNil(t, det.PaymentProofKey)
	assert.Equal(t, proof, *det.PaymentProofKey)
	assert.Empty(t, det.AllowedTransitions)

	require.Len(t, det.History, 2)
	assert.Equal(t, invoices.StatusDraft, det.History[0].FromStatus)
	assert.Equal(t, invoices.StatusSent, det.History[0].ToStatus)
	assert.Nil(t, det.History[0].PaymentProofKey)
	assert.Equal(t, invoices.StatusPaid, det.History[1].ToStatus)
	require.NotNil(t, det.History[1].PaymentProofKey)
	assert.Equal(t, proof, *det.History[1].PaymentProofKey)
	assert.Equal(t, seedUserID, det.History[1].ChangedBy)
}

// Proof is optional for payment.
func TestChangeStatus_PaidWithoutProof(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)
	repo := invoices.NewRepo(tx, testutil.Store(t))

	require.NoError(t, repo.ChangeStatus(ctx, invID, move(invoices.StatusSent), seedUserID))
	require.NoError(t, repo.ChangeStatus(ctx, invID, move(invoices.StatusPaid), seedUserID))

	det, err := repo.GetDetail(ctx, invID)
	require.NoError(t, err)
	require.NotNil(t, det.PaidAt)
	assert.Nil(t, det.PaymentProofKey)
}

func TestChangeStatus_ProofOnlyWhenPaid(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)
	repo := invoices.NewRepo(tx, testutil.Store(t))
	proof := "invoices/" + strconv.FormatInt(invID, 10) + "/1700000000-bukti.pdf"

	err := repo.ChangeStatus(ctx, invID, invoices.ChangeStatusRequest{
		Status: invoices.StatusSent, PaymentProofKey: &proof,
	}, seedUserID)
	require.Error(t, err)
	assert.Equal(t, "P0014", sqlState(err))
}

func TestChangeStatus_CancelKeepsReason(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)
	repo := invoices.NewRepo(tx, testutil.Store(t))
	note := "  Salah alamat penagihan  "

	require.NoError(t, repo.ChangeStatus(ctx, invID, invoices.ChangeStatusRequest{
		Status: invoices.StatusCancelled, Note: &note,
	}, seedUserID))

	det, err := repo.GetDetail(ctx, invID)
	require.NoError(t, err)
	assert.Nil(t, det.PaidAt)
	assert.True(t, det.CanReplace)
	require.Len(t, det.History, 1)
	require.NotNil(t, det.History[0].Note)
	assert.Equal(t, "Salah alamat penagihan", *det.History[0].Note)
}

// No-op saves skip history.
func TestChangeStatus_NoopWritesNoHistory(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)
	repo := invoices.NewRepo(tx, testutil.Store(t))

	require.NoError(t, repo.ChangeStatus(ctx, invID, move(invoices.StatusDraft), seedUserID))

	det, err := repo.GetDetail(ctx, invID)
	require.NoError(t, err)
	assert.Empty(t, det.History)
	assert.NotNil(t, det.History, "history is an empty list, never null")
	assert.False(t, det.CanReplace)
}

// Replacement is offered once.
func TestDetail_CanReplaceOnlyOnce(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)
	repo := invoices.NewRepo(tx, testutil.Store(t))

	require.NoError(t, repo.ChangeStatus(ctx, invID, move(invoices.StatusCancelled), seedUserID))
	_, err := repo.Replace(ctx, invID, seedUserID)
	require.NoError(t, err)

	det, err := repo.GetDetail(ctx, invID)
	require.NoError(t, err)
	assert.False(t, det.CanReplace)
}
