package purchaseorders_test

import (
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// The note is dated when issued.
// Its number carries the month it was issued in, so the note stamps that
// WIB day with the number, keeps it when work is reverted and resumed, and
// prints it as its Date; the client PO date stays on the PO No line.
func TestDeliveryNote_DatedWhenIssued(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	_, poID := createQuotation(t, tx, quotations.CreateRequest{
		CompanyClientID: seedCompanyID,
		DiscountPct:     "0",
		Items: []quotations.CreateItem{{
			RequestedName: "Tali Tambang Nilon", Qty: "4", UnitID: seedUnitID, SellingPrice: "100000",
		}},
	})
	_, err := tx.Exec(ctx, `UPDATE purchase_orders SET po_date = '2025-12-28' WHERE id = $1`, poID)
	require.NoError(t, err)

	var today time.Time
	require.NoError(t, tx.QueryRow(ctx, `SELECT CURRENT_DATE`).Scan(&today))
	reachStatus(t, tx, poID, purchaseorders.StatusOnProgress)
	po, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	require.NotNil(t, po.DeliveryNoteNumber)
	require.NotNil(t, po.DeliveryNoteDate, "issuing the number stamps the date")
	assert.Equal(t, today.Format(time.DateOnly), po.DeliveryNoteDate.Format(time.DateOnly))

	// A resumed PO keeps the note it already issued.
	_, err = tx.Exec(ctx, `UPDATE purchase_orders SET delivery_note_date = '2026-01-05' WHERE id = $1`, poID)
	require.NoError(t, err)
	require.NoError(t, repo.ChangeStatus(ctx, poID, purchaseorders.StatusUploaded, seedUserID))
	require.NoError(t, repo.ChangeStatus(ctx, poID, purchaseorders.StatusOnProgress, seedUserID))
	again, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	assert.Equal(t, *po.DeliveryNoteNumber, *again.DeliveryNoteNumber)
	require.NotNil(t, again.DeliveryNoteDate)
	assert.Equal(t, "2026-01-05", again.DeliveryNoteDate.Format(time.DateOnly))

	srv := execServer(t, tx, poTemplatesRoot(t))
	res := doJSON(t, srv, http.MethodGet, fmt.Sprintf("/purchase-orders/%d/delivery-note.pdf", poID), nil)
	defer res.Body.Close()
	if _, err := exec.LookPath("xelatex"); err != nil {
		t.Skip("xelatex not installed; the PDF body is not checked")
	}
	require.Equal(t, http.StatusOK, res.StatusCode)
	pdf, err := io.ReadAll(res.Body)
	require.NoError(t, err)
	text := pdfText(t, pdf)
	assert.Contains(t, text, "Jakarta, 5 January 2026", "the note is dated when issued")
	assert.Contains(t, text, "28 December 2025", "the PO No line keeps the client PO date")
	assert.NotContains(t, text, "Jakarta, 28 December 2025")
}
