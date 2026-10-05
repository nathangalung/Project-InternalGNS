package invoices_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Invoice numbers sort year first.
// Numbers restart every year, so INV-00009 of 2031 lists before
// INV-00001 of 2032.
func TestList_SortByInvoiceNoYearFirst(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	numbers := []string{"INV-00001/GNS/I/2032", "INV-00009/GNS/XII/2031"}
	for _, no := range numbers {
		_, _, invID := deliveredPOWithInvoice(t, tx)
		_, err := tx.Exec(ctx, `UPDATE invoices SET invoice_no = $2 WHERE id = $1`, invID, no)
		require.NoError(t, err)
	}
	repo := invoices.NewRepo(tx, testutil.Store(t))

	for dir, want := range map[string][]string{
		"asc":  {"INV-00009/GNS/XII/2031", "INV-00001/GNS/I/2032"},
		"desc": {"INV-00001/GNS/I/2032", "INV-00009/GNS/XII/2031"},
	} {
		res, err := repo.List(ctx, invoices.ListFilter{Q: "/203", SortBy: "invoiceNo", SortDir: dir, Limit: 100})
		require.NoError(t, err)
		var got []string
		for _, r := range res.Rows {
			got = append(got, r.InvoiceNo)
		}
		assert.Equal(t, want, got, dir)
	}
}
