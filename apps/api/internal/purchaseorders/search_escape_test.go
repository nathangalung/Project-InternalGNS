package purchaseorders_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Search wildcards match literally.
// A % or _ in the search box is text, not a LIKE wildcard.
func TestRepo_List_EscapesLikeWildcards(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	clientID, _ := probeClient(t, tx, "PT Seratus% Laut")
	_, poID := createQuotation(t, tx, quotations.CreateRequest{
		CompanyClientID: clientID, DiscountPct: "0",
		Items: []quotations.CreateItem{quoteLine(strPtr("Kapal Uji"))},
	})
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))

	ids := func(q string) []int64 {
		t.Helper()
		res, err := repo.List(ctx, purchaseorders.ListFilter{Q: q, Limit: 100})
		require.NoError(t, err)
		out := make([]int64, 0, len(res.Rows))
		for _, r := range res.Rows {
			hit := strings.Contains(r.PoNumber, q) || strings.Contains(r.QuotationNo, q) ||
				strings.Contains(r.CompanyName, q)
			assert.Truef(t, hit, "%q matched %s / %s / %s", q, r.PoNumber, r.QuotationNo, r.CompanyName)
			out = append(out, r.ID)
		}
		return out
	}
	assert.Contains(t, ids("Seratus%"), poID)
	assert.NotContains(t, ids("Seratu_"), poID)
	ids("%")
	ids(`\`)
}
