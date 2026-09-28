package quotations_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
)

// Search wildcards match literally.
// A % or _ in the search box is text, not a LIKE wildcard.
func TestRepo_List_EscapesLikeWildcards(t *testing.T) {
	ctx, repo, tx := newRepo(t)
	id, err := repo.Create(ctx, sampleCreate(), seedUserID)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `UPDATE quotations SET company_client_name = 'PT Seratus% Laut' WHERE id = $1`, id)
	require.NoError(t, err)

	ids := func(q string) []int64 {
		t.Helper()
		res, err := repo.List(ctx, quotations.ListFilter{Q: q, Limit: 100})
		require.NoError(t, err)
		out := make([]int64, 0, len(res.Rows))
		for _, r := range res.Rows {
			hit := strings.Contains(r.QuotationNo, q) || strings.Contains(r.CompanyName, q)
			assert.Truef(t, hit, "%q matched %s / %s", q, r.QuotationNo, r.CompanyName)
			out = append(out, r.ID)
		}
		return out
	}
	assert.Contains(t, ids("Seratus%"), id)
	assert.NotContains(t, ids("Seratu_"), id)
	ids("%")
	ids(`\`)
}
