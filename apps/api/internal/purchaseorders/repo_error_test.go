package purchaseorders_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

func TestRepo_ErrorPaths(t *testing.T) {
	store := testutil.Store(t)
	r := purchaseorders.NewRepo(testutil.FakeExec{}, store)
	ctx := context.Background()

	_, err := r.List(ctx, nil, nil, 10, 0)
	assert.ErrorIs(t, err, testutil.ErrFake)

	_, err = r.GetByID(ctx, 1)
	assert.ErrorIs(t, err, testutil.ErrFake)

	_, err = r.GetByQuotation(ctx, 1)
	assert.ErrorIs(t, err, testutil.ErrFake)

	err = r.ChangeStatus(ctx, 1, purchaseorders.StatusUploaded, 1)
	assert.ErrorIs(t, err, testutil.ErrFake)

	err = r.UpdateNotes(ctx, 1, "x", 1)
	assert.ErrorIs(t, err, testutil.ErrFake)

	err = r.UpdateFile(ctx, 1, purchaseorders.UpdateFileRequest{
		FileName: "x.pdf", FileSize: 1, FileURL: "x",
	}, 1)
	assert.ErrorIs(t, err, testutil.ErrFake)
}
