package purchaseorders_test

import (
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const deliveredLockedMsg = "PO yang sudah dikirim hanya bisa diubah jika invoicenya dibatalkan dan invoice pengganti belum diterbitkan."

// Invoice states of a delivered PO.
func cancelInvoice(t *testing.T, tx pgx.Tx, qID int64) {
	t.Helper()
	setInvoiceStatus(t, tx, qID, "cancelled")
}

func replaceInvoice(t *testing.T, tx pgx.Tx, qID int64) {
	t.Helper()
	cancelInvoice(t, tx, qID)
	_, err := tx.Exec(t.Context(), `
		SELECT fn_replace_invoice(id, $2) FROM invoices WHERE quotation_id = $1`, qID, seedUserID)
	require.NoError(t, err)
}

func dropInvoices(t *testing.T, tx pgx.Tx, qID int64) {
	t.Helper()
	_, err := tx.Exec(t.Context(), `DELETE FROM invoices WHERE quotation_id = $1`, qID)
	require.NoError(t, err)
}

// Cancelled invoice reopens delivered lines.
// A delivered PO's lines open only while its invoice is cancelled and no
// live invoice replaces it, so the Pengganti bills the corrected lines.
func TestRepo_UpdateItems_DeliveredOpensWhileInvoiceCancelled(t *testing.T) {
	cases := []struct {
		name    string
		arrange func(t *testing.T, tx pgx.Tx, qID int64)
		wantMsg string
	}{
		{name: "draft invoice locks", arrange: func(*testing.T, pgx.Tx, int64) {}, wantMsg: deliveredLockedMsg},
		{name: "sent invoice locks", arrange: func(t *testing.T, tx pgx.Tx, qID int64) {
			setInvoiceStatus(t, tx, qID, "sent")
		}, wantMsg: deliveredLockedMsg},
		{name: "paid invoice locks", arrange: func(t *testing.T, tx pgx.Tx, qID int64) {
			setInvoiceStatus(t, tx, qID, "paid")
		}, wantMsg: deliveredLockedMsg},
		{name: "cancelled invoice opens", arrange: cancelInvoice},
		{name: "pengganti locks again", arrange: replaceInvoice, wantMsg: deliveredLockedMsg},
		{name: "no invoice stays locked", arrange: dropInvoices, wantMsg: deliveredLockedMsg},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			qID, poID := deliveredPO(t, tx)
			tc.arrange(t, tx, qID)
			repo := purchaseorders.NewRepo(tx, testutil.Store(t))

			before, err := repo.GetByID(ctx, poID)
			require.NoError(t, err)
			assert.Equal(t, tc.wantMsg != "", before.LinesLocked)

			req := itemsWith(purchaseorders.UpdateItemsLine{})
			req.Items[0].Qty = "3"
			req.ShippingAddress = strPtr("Jl. Pelabuhan 1, Jakarta")
			_, err = repo.UpdateItems(ctx, poID, req, seedUserID, &before.RowVersion)
			if tc.wantMsg != "" {
				require.ErrorIs(t, err, purchaseorders.ErrLocked)
				assert.Equal(t, tc.wantMsg, err.Error())
				return
			}
			require.NoError(t, err)
			items, err := repo.ListItems(ctx, poID)
			require.NoError(t, err)
			require.Len(t, items, 2)
			assert.Equal(t, "3.00", items[0].Qty)
		})
	}
}

// Reopened lines keep delivery gates.
// The PO already passed DELIVERED, so an edit while its invoice is cancelled
// may not leave it billing Rp 0 or without an address for its goods.
func TestRepo_UpdateItems_ReopenedDeliveredKeepsGates(t *testing.T) {
	const (
		zeroMsg    = "Jumlah semua baris produk masih 0. Isi jumlah minimal satu baris produk."
		addressMsg = "Alamat pengiriman wajib diisi selama ada baris produk tanpa alamat tujuan."
	)
	address := "Jl. Pelabuhan 1, Jakarta"
	cases := []struct {
		name    string
		qty     string
		address *string
		dest    *string
		wantMsg string
	}{
		{name: "every line at qty 0", qty: "0", address: &address, wantMsg: zeroMsg},
		{name: "blank address", qty: "2", wantMsg: addressMsg},
		{name: "blank address, line addressed", qty: "2", dest: &address},
		{name: "quantity and address", qty: "2", address: &address},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			qID, poID := deliveredPO(t, tx)
			cancelInvoice(t, tx, qID)
			repo := purchaseorders.NewRepo(tx, testutil.Store(t))

			req := itemsWith(purchaseorders.UpdateItemsLine{ShipDestination: tc.dest})
			req.Items[0].Qty = tc.qty
			req.ShippingAddress = tc.address
			_, err := repo.UpdateItems(ctx, poID, req, seedUserID, nil)
			if tc.wantMsg == "" {
				require.NoError(t, err)
				return
			}
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.wantMsg)
		})
	}

	// Before delivery the gate still runs at the move.
	t.Run("in progress keeps qty 0 and no address", func(t *testing.T) {
		ctx, tx := testutil.BeginTx(t)
		_, poID := poAt(t, tx, purchaseorders.StatusOnProgress)
		req := itemsWith(purchaseorders.UpdateItemsLine{})
		req.Items[0].Qty = "0"
		_, err := purchaseorders.NewRepo(tx, testutil.Store(t)).UpdateItems(ctx, poID, req, seedUserID, nil)
		require.NoError(t, err)
	})
}

// Lines lock per status.
// The flag mirrors fn_update_po_items for every PO state.
func TestRepo_LinesLocked_PerStatus(t *testing.T) {
	cases := []struct {
		status purchaseorders.Status
		locked bool
	}{
		{purchaseorders.StatusPending, false},
		{purchaseorders.StatusUploaded, false},
		{purchaseorders.StatusOnProgress, false},
		{purchaseorders.StatusDelivered, true},
		{purchaseorders.StatusCancelled, true},
	}
	for _, tc := range cases {
		t.Run(string(tc.status), func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			qID, poID := poAt(t, tx, tc.status)
			repo := purchaseorders.NewRepo(tx, testutil.Store(t))

			byID, err := repo.GetByID(ctx, poID)
			require.NoError(t, err)
			assert.Equal(t, tc.locked, byID.LinesLocked)
			byQuotation, err := repo.GetByQuotation(ctx, qID)
			require.NoError(t, err)
			assert.Equal(t, tc.locked, byQuotation.LinesLocked)
			list, err := repo.List(ctx, purchaseorders.ListFilter{Q: byID.QuotationNo, Limit: 10})
			require.NoError(t, err)
			require.Len(t, list.Rows, 1)
			assert.Equal(t, tc.locked, list.Rows[0].LinesLocked)
		})
	}
}
