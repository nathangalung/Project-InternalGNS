package quotations_test

import (
	"context"
	"sync"
	"testing"
	"time"

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

// Contact change racing a send.
// The change waits for the send and then reports the status, not a bad
// contact.
func TestRepo_UpdateContactRacingSend(t *testing.T) {
	pool := testutil.Pool(t)
	ctx := context.Background()
	require.NoError(t, testutil.ResetQuotationDomain(ctx, pool))
	t.Cleanup(func() { _ = testutil.ResetQuotationDomain(ctx, pool) })
	repo := quotations.NewRepo(pool, testutil.Store(t))
	id, err := repo.Create(ctx, sampleCreate(), seedUserID)
	require.NoError(t, err)

	sender, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer func() { _ = sender.Rollback(ctx) }()
	var senderPID int32
	require.NoError(t, sender.QueryRow(ctx, "SELECT pg_backend_pid()").Scan(&senderPID))
	_, err = sender.Exec(ctx, `UPDATE quotations SET status = 'sent' WHERE id = $1`, id)
	require.NoError(t, err)

	done := make(chan error, 1)
	go func() { done <- repo.UpdateContact(ctx, id, seedContactID, seedUserID) }()
	require.Eventually(t, func() bool {
		var waiting bool
		_ = pool.QueryRow(ctx, `SELECT EXISTS (
			SELECT 1 FROM pg_stat_activity WHERE $1 = ANY (pg_blocking_pids(pid)))`, senderPID).Scan(&waiting)
		return waiting
	}, 5*time.Second, 10*time.Millisecond, "the contact change waits for the send")
	require.NoError(t, sender.Commit(ctx))

	select {
	case err = <-done:
		assert.ErrorIs(t, err, quotations.ErrContactLocked)
	case <-time.After(5 * time.Second):
		t.Fatal("the contact change never finished")
	}
}
