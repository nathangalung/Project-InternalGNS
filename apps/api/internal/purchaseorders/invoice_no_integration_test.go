package purchaseorders_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// A delivered PO names its invoice.
// The PO page links to it; before delivery there is none.
func TestRepo_InvoiceNo(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))

	_, openID := poAt(t, tx, purchaseorders.StatusOnProgress)
	open, err := repo.GetByID(ctx, openID)
	require.NoError(t, err)
	assert.Nil(t, open.InvoiceNo)

	qID, poID := poAt(t, tx, purchaseorders.StatusDelivered)
	var want string
	require.NoError(t, tx.QueryRow(ctx, `SELECT invoice_no FROM invoices WHERE po_id = $1`, poID).Scan(&want))

	byID, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	require.NotNil(t, byID.InvoiceNo)
	assert.Equal(t, want, *byID.InvoiceNo)

	byQuotation, err := repo.GetByQuotation(ctx, qID)
	require.NoError(t, err)
	require.NotNil(t, byQuotation.InvoiceNo)
	assert.Equal(t, want, *byQuotation.InvoiceNo)
}
