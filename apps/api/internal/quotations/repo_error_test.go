package quotations_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

func TestRepo_ErrorPaths(t *testing.T) {
	r := quotations.NewRepo(testutil.FakeExec{}, testutil.Store(t))
	ctx := context.Background()

	_, err := r.List(ctx, quotations.ListFilter{Limit: 10})
	assert.ErrorIs(t, err, testutil.ErrFake)

	_, err = r.Stats(ctx)
	assert.ErrorIs(t, err, testutil.ErrFake)

	_, err = r.GetDetail(ctx, 1)
	assert.ErrorIs(t, err, testutil.ErrFake)

	_, err = r.Create(ctx, quotations.CreateRequest{
		CompanyClientID: 1,
		DiscountPct:     "0",
		Items: []quotations.CreateItem{
			{RequestedName: "X", Qty: "1", UnitID: 19, SellingPrice: "1"},
		},
	}, 1)
	assert.ErrorIs(t, err, testutil.ErrFake)

	_, err = r.Update(ctx, 1, quotations.UpdateRequest{
		DiscountPct: "0",
		Items: []quotations.CreateItem{
			{RequestedName: "X", Qty: "1", UnitID: 19, SellingPrice: "1"},
		},
	}, 1)
	assert.ErrorIs(t, err, testutil.ErrFake)

	err = r.ChangeStatus(ctx, 1, "sent", nil, 1)
	assert.ErrorIs(t, err, testutil.ErrFake)
}

// GetDetail fails on 2nd, 3rd.
func TestRepo_GetDetail_MidQueryFails(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	store := testutil.Store(t)

	build := func(failAfter int) *quotations.Repo {
		exec := &testutil.CountingExec{Inner: tx, FailAfter: failAfter}
		return quotations.NewRepo(exec, store)
	}

	seedRepo := quotations.NewRepo(tx, store)
	id, err := seedRepo.Create(ctx, quotations.CreateRequest{
		CompanyClientID: 1,
		DiscountPct:     "0",
		Items: []quotations.CreateItem{
			{RequestedName: "X", Qty: "1", UnitID: 19, SellingPrice: "1"},
		},
	}, 1)
	require.NoError(t, err)

	_, err = build(1).GetDetail(ctx, id)
	assert.ErrorIs(t, err, testutil.ErrFake)

	_, err = build(2).GetDetail(ctx, id)
	assert.ErrorIs(t, err, testutil.ErrFake)
}
