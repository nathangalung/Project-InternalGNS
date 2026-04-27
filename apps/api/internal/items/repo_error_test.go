package items_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

func TestRepo_ErrorPaths(t *testing.T) {
	store := testutil.Store(t)
	r := items.NewRepo(testutil.FakeExec{}, store)
	ctx := context.Background()

	_, err := r.List(ctx, 10, 0)
	assert.ErrorIs(t, err, testutil.ErrFake)

	_, err = r.GetByID(ctx, 1)
	assert.ErrorIs(t, err, testutil.ErrFake)

	_, err = r.Create(ctx, items.CreateItemRequest{Name: "x"}, 1)
	assert.ErrorIs(t, err, testutil.ErrFake)

	_, err = r.Search(ctx, "x", 0.1, 5)
	assert.ErrorIs(t, err, testutil.ErrFake)

	_, err = r.MatchRequest(ctx, "x", 5)
	assert.ErrorIs(t, err, testutil.ErrFake)

	_, err = r.ListVendorsForItem(ctx, 1)
	assert.ErrorIs(t, err, testutil.ErrFake)

	_, err = r.SuggestSellingPrices(ctx, 1, 5)
	assert.ErrorIs(t, err, testutil.ErrFake)
}
