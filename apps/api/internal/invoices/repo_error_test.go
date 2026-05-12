package invoices_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

func TestRepo_ErrorPaths(t *testing.T) {
	store := testutil.Store(t)
	r := invoices.NewRepo(testutil.FakeExec{}, store)
	ctx := context.Background()

	_, err := r.List(ctx, invoices.ListFilter{Limit: 10})
	assert.ErrorIs(t, err, testutil.ErrFake)

	_, err = r.GetByID(ctx, 1)
	assert.ErrorIs(t, err, testutil.ErrFake)

	_, err = r.GetByQuotation(ctx, 1)
	assert.ErrorIs(t, err, testutil.ErrFake)

	err = r.ChangeStatus(ctx, 1, invoices.StatusSent, 1)
	assert.ErrorIs(t, err, testutil.ErrFake)

	_, err = r.UpdateDates(ctx, 1, invoices.UpdateDatesRequest{}, 1, nil)
	assert.ErrorIs(t, err, testutil.ErrFake)

	_, err = r.Summary(ctx)
	assert.ErrorIs(t, err, testutil.ErrFake)
}
