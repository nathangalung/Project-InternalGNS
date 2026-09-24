package purchaseorders_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Each read wraps the failing query's error.
func TestRepo_ReadFaults(t *testing.T) {
	ctx := context.Background()
	repo := purchaseorders.NewRepo(testutil.FakeExec{}, testutil.Store(t))

	_, err := repo.History(ctx, 1)
	assert.ErrorIs(t, err, testutil.ErrFake)
	assert.ErrorContains(t, err, "query po history")

	_, err = repo.Completeness(ctx, 1)
	assert.ErrorIs(t, err, testutil.ErrFake)
	assert.ErrorContains(t, err, "query client completeness")

	assert.ErrorIs(t, repo.RemoveFile(ctx, 1, seedUserID), testutil.ErrFake)
	assert.ErrorIs(t, repo.UpdateDetails(ctx, 1, "PO/1", poDateFixture(), seedUserID, nil), testutil.ErrFake)
}

// A failure after the first query still surfaces.
func TestRepo_SecondQueryFaults(t *testing.T) {
	tests := []struct {
		name string
		run  func(repo *purchaseorders.Repo, poID int64) error
		want string
	}{
		{"list rows after the count", func(repo *purchaseorders.Repo, _ int64) error {
			_, err := repo.List(context.Background(), purchaseorders.ListFilter{Limit: 1})
			return err
		}, ""},
		{"vendor completeness after the client", func(repo *purchaseorders.Repo, poID int64) error {
			_, err := repo.Completeness(context.Background(), poID)
			return err
		}, "query vendor completeness"},
		{"row version after an unguarded edit", func(repo *purchaseorders.Repo, poID int64) error {
			_, err := repo.UpdateItems(context.Background(), poID, itemsAt("1000"), seedUserID, nil)
			return err
		}, ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, tx := testutil.BeginTx(t)
			_, poID := acceptedQuotationWithPO(t, tx)
			repo := purchaseorders.NewRepo(&testutil.CountingExec{Inner: tx, FailAfter: 1}, testutil.Store(t))
			err := tc.run(repo, poID)
			require.ErrorIs(t, err, testutil.ErrFake)
			if tc.want != "" {
				assert.ErrorContains(t, err, tc.want)
			}
		})
	}
}

// An unknown PO has no completeness answer.
func TestRepo_Completeness_NotFound(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, err := purchaseorders.NewRepo(tx, testutil.Store(t)).Completeness(ctx, 99999999)
	assert.ErrorIs(t, err, purchaseorders.ErrNotFound)
}

// An edit without lines drops every line.
// A nil slice is sent as an empty array, not as JSON null, which the
// function would refuse.
func TestRepo_UpdateItems_NilItemsClearsLines(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID := acceptedQuotationWithPO(t, tx)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))

	_, err := repo.UpdateItems(ctx, poID, purchaseorders.UpdateItemsRequest{DiscountPct: "0"}, seedUserID, nil)
	require.NoError(t, err)
	items, err := repo.ListItems(ctx, poID)
	require.NoError(t, err)
	assert.Empty(t, items)
	po, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	assert.Equal(t, "0", po.PoGrandTotal)
}
