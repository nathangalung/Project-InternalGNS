package quotations_test

import (
	"strconv"
	"strings"
	"testing"
	"time"

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

// A month and year find numbers.
// The month is matched between slashes, so I/1999 never finds II/1999.
// 1999 keeps every other row out.
func TestRepo_List_PeriodSearch(t *testing.T) {
	ctx, repo, tx := newRepo(t)
	tag := strconv.FormatInt(time.Now().UnixNano(), 36)
	numbered := func(no string) int64 {
		t.Helper()
		id, err := repo.Create(ctx, sampleCreate(), seedUserID)
		require.NoError(t, err)
		_, err = tx.Exec(ctx, `UPDATE quotations SET quotation_no = $2 WHERE id = $1`, id, no)
		require.NoError(t, err)
		return id
	}
	october := numbered("Q-" + tag + "1/GNS/X/1999")
	january := numbered("Q-" + tag + "2/GNS/I/1999")
	february := numbered("Q-" + tag + "3/GNS/II/1999 Rev.1")

	tests := []struct {
		q    string
		want []int64
	}{
		{"10/1999", []int64{october}},
		{"x / 1999", []int64{october}},
		{"1/1999", []int64{january}},
		{"I/1999", []int64{january}},
		{"02/1999", []int64{february}},
		{"II/1999", []int64{february}},
		{"13/1999", []int64{}},
	}
	for _, tc := range tests {
		t.Run(tc.q, func(t *testing.T) {
			res, err := repo.List(ctx, quotations.ListFilter{Q: tc.q, Limit: 100})
			require.NoError(t, err)
			got := make([]int64, 0, len(res.Rows))
			for _, r := range res.Rows {
				got = append(got, r.ID)
			}
			assert.ElementsMatch(t, tc.want, got)
		})
	}
}
