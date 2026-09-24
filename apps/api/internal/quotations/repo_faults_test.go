package quotations_test

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// badScanExec answers one query with a foreign column.
// The rows arrive, but no field matches, so the scan fails.
type badScanExec struct {
	inner quotations.Executor
	at    int
	calls int
}

func (e *badScanExec) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	e.calls++
	if e.calls == e.at {
		return e.inner.Query(ctx, `SELECT 1 AS unexpected_column`)
	}
	return e.inner.Query(ctx, sql, args...)
}

func (e *badScanExec) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return e.inner.QueryRow(ctx, sql, args...)
}

func (e *badScanExec) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	return e.inner.Exec(ctx, sql, args...)
}

// Every repo call surfaces a failed query.
func TestRepo_QueryFailuresPropagate(t *testing.T) {
	r := quotations.NewRepo(testutil.FakeExec{}, testutil.Store(t))
	ctx := context.Background()

	cases := []struct {
		name string
		call func() error
	}{
		{"update contact", func() error { return r.UpdateContact(ctx, 1, 1, 1) }},
		{"list revisions", func() error { _, err := r.ListRevisions(ctx, 1); return err }},
		{"revise", func() error { _, err := r.Revise(ctx, 1, nil, 1); return err }},
		{"expire due", func() error { _, err := r.ExpireDue(ctx, time.Now()); return err }},
		{"list requests", func() error { _, err := r.ListItemRequests(ctx, 1); return err }},
		{"get request", func() error { _, err := r.GetItemRequest(ctx, 1); return err }},
		{"create request", func() error {
			_, err := r.CreateItemRequest(ctx, 1, quotations.ItemRequestCreate{LineNo: 1, RequestText: "X"}, 1)
			return err
		}},
		{"update request", func() error {
			_, err := r.UpdateItemRequest(ctx, 1, 1, quotations.ItemRequestUpdate{LineNo: 1, RequestText: "X"}, 1)
			return err
		}},
		{"delete request", func() error { return r.DeleteItemRequest(ctx, 1, 1) }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			assert.ErrorIs(t, c.call(), testutil.ErrFake)
		})
	}
}

// A failure after the first statement still surfaces.
func TestRepo_SecondQueryFailures(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	store := testutil.Store(t)
	id, err := quotations.NewRepo(tx, store).Create(ctx, sampleCreate(), seedUserID)
	require.NoError(t, err)
	failSecond := func() *quotations.Repo {
		return quotations.NewRepo(&testutil.CountingExec{Inner: tx, FailAfter: 1}, store)
	}

	t.Run("list data after count", func(t *testing.T) {
		_, err := failSecond().List(ctx, quotations.ListFilter{Limit: 10})
		assert.ErrorIs(t, err, testutil.ErrFake)
	})
	t.Run("row version after legacy update", func(t *testing.T) {
		_, err := failSecond().Update(ctx, id, quotations.UpdateRequest{
			DiscountPct: "0", Items: sampleCreate().Items,
		}, seedUserID, nil)
		assert.ErrorIs(t, err, testutil.ErrFake)
	})
}

// A row that does not scan is an error, not a partial result.
func TestRepo_ScanFailuresPropagate(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	store := testutil.Store(t)
	id, err := quotations.NewRepo(tx, store).Create(ctx, sampleCreate(), seedUserID)
	require.NoError(t, err)
	rid, err := quotations.NewRepo(tx, store).CreateItemRequest(ctx, id, sampleItemRequest(), seedUserID)
	require.NoError(t, err)
	corrupt := func(at int) *quotations.Repo {
		return quotations.NewRepo(&badScanExec{inner: tx, at: at}, store)
	}

	cases := []struct {
		name string
		call func() error
	}{
		{"stats", func() error { _, err := corrupt(1).Stats(ctx); return err }},
		{"detail header", func() error { _, err := corrupt(1).GetDetail(ctx, id); return err }},
		{"detail items", func() error { _, err := corrupt(2).GetDetail(ctx, id); return err }},
		{"detail history", func() error { _, err := corrupt(3).GetDetail(ctx, id); return err }},
		{"list rows", func() error { _, err := corrupt(1).List(ctx, quotations.ListFilter{Limit: 10}); return err }},
		{"list requests", func() error { _, err := corrupt(1).ListItemRequests(ctx, id); return err }},
		{"get request", func() error { _, err := corrupt(1).GetItemRequest(ctx, rid.ID); return err }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := c.call()
			require.Error(t, err)
			assert.NotErrorIs(t, err, quotations.ErrNotFound)
			assert.Contains(t, err.Error(), "unexpected_column")
		})
	}
}
