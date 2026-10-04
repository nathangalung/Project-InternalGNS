package invoices_test

import (
	"strconv"
	"strings"
	"testing"
	"time"

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

// Month-year search finds numbers.
// Only the invoice number carries the period; its quotation is found by
// typed text alone. 1999 keeps every other row out.
func TestRepo_List_PeriodSearch(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	tag := strconv.FormatInt(time.Now().UnixNano(), 36)
	quotedNovember, _, october := deliveredPOWithInvoice(t, tx)
	_, _, february := deliveredPOWithInvoice(t, tx)
	_, _, january := deliveredPOWithInvoice(t, tx)
	for id, no := range map[int64]string{
		october:  "INV-" + tag + "1/GNS/X/1999",
		february: "INV-" + tag + "2/GNS/II/1999",
		january:  "INV-" + tag + "3/GNS/I/1999",
	} {
		_, err := tx.Exec(ctx, `UPDATE invoices SET invoice_no = $2 WHERE id = $1`, id, no)
		require.NoError(t, err)
	}
	_, err := tx.Exec(ctx, `UPDATE quotations SET quotation_no = $2 WHERE id = $1`,
		quotedNovember, "Q-"+tag+"9/GNS/XI/1999")
	require.NoError(t, err)
	repo := invoices.NewRepo(tx, testutil.Store(t))

	tests := []struct {
		q    string
		want []int64
	}{
		{"10/1999", []int64{october}},
		{"X/1999", []int64{october}},
		{"2/1999", []int64{february}},
		{"1/1999", []int64{january}},
		{"i / 1999", []int64{january}},
		{"11/1999", []int64{}},
		{"Q-" + tag + "9", []int64{october}},
		{"0/1999", []int64{}},
	}
	for _, tc := range tests {
		t.Run(tc.q, func(t *testing.T) {
			res, err := repo.List(ctx, invoices.ListFilter{Q: tc.q, Limit: 100})
			require.NoError(t, err)
			got := make([]int64, 0, len(res.Rows))
			for _, r := range res.Rows {
				got = append(got, r.ID)
			}
			assert.ElementsMatch(t, tc.want, got)
		})
	}
}
