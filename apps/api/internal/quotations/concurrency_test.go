package quotations_test

import (
	"context"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Parallel creates get distinct numbers.
func TestRepo_ConcurrentCreatesGetDistinctNumbers(t *testing.T) {
	pool := testutil.Pool(t)
	ctx := context.Background()
	require.NoError(t, testutil.ResetQuotationDomain(ctx, pool))
	t.Cleanup(func() { _ = testutil.ResetQuotationDomain(ctx, pool) })
	repo := quotations.NewRepo(pool, testutil.Store(t))

	const n = 8
	ids := make([]int64, n)
	errs := make([]error, n)
	var wg sync.WaitGroup
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ids[i], errs[i] = repo.Create(ctx, sampleCreate(), seedUserID)
		}()
	}
	wg.Wait()

	seen := map[string]int64{}
	for i := range n {
		require.NoError(t, errs[i])
		d, err := repo.GetDetail(ctx, ids[i])
		require.NoError(t, err)
		if prev, dup := seen[d.QuotationNo]; dup {
			t.Fatalf("quotations %d and %d share number %s", prev, ids[i], d.QuotationNo)
		}
		seen[d.QuotationNo] = ids[i]
	}
	assert.Len(t, seen, n)
}
