package invoices_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// currentDN matches the note format.
const currentDN = `^DN-[0-9]{5,}/GNS/[IVX]+/[0-9]{4}$`

// deliveryNoteOf reads a PO's note number.
func deliveryNoteOf(t *testing.T, ctx context.Context, tx pgx.Tx, poID int64) string {
	t.Helper()
	var dn string
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT delivery_note_number FROM purchase_orders WHERE id = $1`, poID).Scan(&dn))
	return dn
}

// Invoice takes its delivery note's number.
// DN-00071/GNS/X/2026 bills as INV-00071/GNS/X/2026, and every Pengganti
// keeps that number with Rev.n.
func TestRepo_InvoiceNumberFollowsDeliveryNote(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID, invID := deliveredPOWithInvoice(t, tx)
	repo := invoices.NewRepo(tx, testutil.Store(t))

	dn := deliveryNoteOf(t, ctx, tx, poID)
	require.Regexp(t, currentDN, dn)
	base := "INV" + dn[2:]

	first, err := repo.GetDetail(ctx, invID)
	require.NoError(t, err)
	assert.Equal(t, base, first.InvoiceNo)

	id := invID
	for _, want := range []string{base + " Rev.1", base + " Rev.2"} {
		require.NoError(t, repo.ChangeStatus(ctx, id, move(invoices.StatusCancelled), seedUserID))
		det, err := repo.Replace(ctx, id, seedUserID)
		require.NoError(t, err)
		assert.Equal(t, want, det.InvoiceNo)
		require.NotNil(t, det.ReplacesInvoiceNo)
		id = det.ID
	}
	// The note itself never changes.
	assert.Equal(t, dn, deliveryNoteOf(t, ctx, tx, poID))
}

// Older note format draws a fresh number.
// A PO imported with a note from before the current format bills under a
// number from the DN counter, so no later note can carry the same one.
func TestRepo_InvoiceNumberForOlderNote(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	qid, poID := uploadedPO(t, tx, oneLineQuotation())
	const older = "0042/DO-GNS/X/2025"
	_, err := tx.Exec(ctx, `UPDATE purchase_orders SET delivery_note_number = $2 WHERE id = $1`, poID, older)
	require.NoError(t, err)

	porepo := purchaseorders.NewRepo(tx, testutil.Store(t))
	require.NoError(t, porepo.ChangeStatus(ctx, poID, purchaseorders.StatusOnProgress, seedUserID))
	require.NoError(t, porepo.ChangeStatus(ctx, poID, purchaseorders.StatusDelivered, seedUserID))
	inv, err := invoices.NewRepo(tx, testutil.Store(t)).GetByQuotation(ctx, qid)
	require.NoError(t, err)

	assert.Equal(t, older, deliveryNoteOf(t, ctx, tx, poID), "a stamped note keeps its number")
	var next string
	require.NoError(t, tx.QueryRow(ctx, `SELECT fn_next_doc_no('DN')`).Scan(&next))
	require.Regexp(t, currentDN, next)
	var took, following int
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT substring($1 FROM '^INV-([0-9]+)/')::int, substring($2 FROM '^DN-([0-9]+)/')::int`,
		inv.InvoiceNo, next).Scan(&took, &following))
	assert.Equal(t, following-1, took, "%s took the DN counter's number before %s", inv.InvoiceNo, next)
}

// A PO without a note is refused.
// Both callers stamp the note first, so this guards the function itself.
func TestFnCreateInvoice_RefusesPOWithoutNote(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID := uploadedPO(t, tx, oneLineQuotation())

	var id int64
	err := tx.QueryRow(ctx, `SELECT fn_create_invoice($1, $2)`, poID, seedUserID).Scan(&id)
	require.ErrorContains(t, err, "belum memiliki nomor surat jalan")
}
