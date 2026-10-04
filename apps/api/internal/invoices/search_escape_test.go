package invoices_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Search wildcards match literally.
// A % or _ in the search box is text, not a LIKE wildcard.
func TestRepo_List_EscapesLikeWildcards(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)
	_, err := tx.Exec(ctx, `
		UPDATE company_client SET name = 'PT Seratus% Laut'
		WHERE id = (SELECT company_client_id FROM invoices WHERE id = $1)`, invID)
	require.NoError(t, err)
	// The row shows the invoiced name.
	_, err = tx.Exec(ctx, `UPDATE invoices SET buyer_name = 'PT Seratus% Laut' WHERE id = $1`, invID)
	require.NoError(t, err)
	repo := invoices.NewRepo(tx, testutil.Store(t))

	ids := func(q string) []int64 {
		t.Helper()
		res, err := repo.List(ctx, invoices.ListFilter{Q: q, Limit: 100})
		require.NoError(t, err)
		out := make([]int64, 0, len(res.Rows))
		for _, r := range res.Rows {
			hit := strings.Contains(r.InvoiceNo, q) || strings.Contains(r.QuotationNo, q) ||
				strings.Contains(r.CompanyName, q)
			assert.Truef(t, hit, "%q matched %s / %s / %s", q, r.InvoiceNo, r.QuotationNo, r.CompanyName)
			out = append(out, r.ID)
		}
		return out
	}
	assert.Contains(t, ids("Seratus%"), invID)
	assert.NotContains(t, ids("Seratu_"), invID)
	ids("%")
	ids(`\`)
}
