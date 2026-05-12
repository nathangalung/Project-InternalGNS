package quotations_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
)

func newRepoWithQuotation(t *testing.T) (context.Context, *quotations.Repo, int64) {
	t.Helper()
	ctx, repo, _ := newRepo(t)
	id, err := repo.Create(ctx, sampleCreate(), seedUserID)
	require.NoError(t, err)
	return ctx, repo, id
}

func sampleItemRequest() quotations.ItemRequestCreate {
	impa := "RFQ-001"
	qty := "5"
	uom := "PCS"
	notes := "from email"
	return quotations.ItemRequestCreate{
		LineNo:       1,
		RequestText:  "LAMP LED 12W",
		RequestImpa:  &impa,
		RequestedQty: &qty,
		RequestedUom: &uom,
		Notes:        &notes,
	}
}

func TestQIR_CreateThenList(t *testing.T) {
	ctx, repo, qid := newRepoWithQuotation(t)

	empty, err := repo.ListItemRequests(ctx, qid)
	require.NoError(t, err)
	assert.Empty(t, empty)

	created, err := repo.CreateItemRequest(ctx, qid, sampleItemRequest(), seedUserID)
	require.NoError(t, err)
	assert.Equal(t, qid, created.QuotationID)
	assert.Equal(t, int32(1), created.LineNo)
	assert.Equal(t, "pending", created.MatchStatus)
	assert.Equal(t, "manual", created.SourceType)
	require.NotNil(t, created.RequestedQty)
	assert.Equal(t, "5.000", *created.RequestedQty)
	assert.Equal(t, int32(0), created.RowVersion)
	assert.Nil(t, created.ReviewedBy)

	rows, err := repo.ListItemRequests(ctx, qid)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	assert.Equal(t, created.ID, rows[0].ID)
}

func TestQIR_GetReturnsRow(t *testing.T) {
	ctx, repo, qid := newRepoWithQuotation(t)
	created, err := repo.CreateItemRequest(ctx, qid, sampleItemRequest(), seedUserID)
	require.NoError(t, err)

	got, err := repo.GetItemRequest(ctx, created.ID)
	require.NoError(t, err)
	assert.Equal(t, created.ID, got.ID)
	assert.Equal(t, "LAMP LED 12W", got.RequestText)
}

func TestQIR_GetNotFound(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	_, err := repo.GetItemRequest(ctx, 9999999)
	assert.ErrorIs(t, err, quotations.ErrNotFound)
}

func TestQIR_RejectsWhenParentSent(t *testing.T) {
	ctx, repo, qid := newRepoWithQuotation(t)
	require.NoError(t, repo.ChangeStatus(ctx, qid, "sent", nil, seedUserID))

	_, err := repo.CreateItemRequest(ctx, qid, sampleItemRequest(), seedUserID)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Only draft/revision")
}

func TestQIR_UpdateSetsReviewedOnFirstNonPending(t *testing.T) {
	ctx, repo, qid := newRepoWithQuotation(t)
	created, err := repo.CreateItemRequest(ctx, qid, sampleItemRequest(), seedUserID)
	require.NoError(t, err)
	assert.Nil(t, created.ReviewedBy)
	assert.Nil(t, created.ReviewedAt)

	matchedID := int64(9000001)
	upd := quotations.ItemRequestUpdate{
		LineNo:        created.LineNo,
		RequestText:   created.RequestText,
		MatchedItemID: &matchedID,
		MatchStatus:   "matched",
		SourceType:    created.SourceType,
	}
	updated, err := repo.UpdateItemRequest(ctx, created.ID, upd, seedUserID)
	require.NoError(t, err)
	assert.Equal(t, "matched", updated.MatchStatus)
	require.NotNil(t, updated.ReviewedBy)
	assert.Equal(t, seedUserID, *updated.ReviewedBy)
	require.NotNil(t, updated.ReviewedAt)
	assert.Equal(t, int32(1), updated.RowVersion)
}

func TestQIR_UpdateRowVersionIncrements(t *testing.T) {
	ctx, repo, qid := newRepoWithQuotation(t)
	created, err := repo.CreateItemRequest(ctx, qid, sampleItemRequest(), seedUserID)
	require.NoError(t, err)
	assert.Equal(t, int32(0), created.RowVersion)

	upd := quotations.ItemRequestUpdate{
		LineNo:      created.LineNo,
		RequestText: "changed text",
		MatchStatus: created.MatchStatus,
		SourceType:  created.SourceType,
	}
	u1, err := repo.UpdateItemRequest(ctx, created.ID, upd, seedUserID)
	require.NoError(t, err)
	assert.Equal(t, int32(1), u1.RowVersion)

	u2, err := repo.UpdateItemRequest(ctx, created.ID, upd, seedUserID)
	require.NoError(t, err)
	assert.Equal(t, int32(2), u2.RowVersion)
}

func TestQIR_UpdateNotFound(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	upd := quotations.ItemRequestUpdate{
		LineNo:      1,
		RequestText: "x",
		MatchStatus: "pending",
		SourceType:  "manual",
	}
	_, err := repo.UpdateItemRequest(ctx, 9999999, upd, seedUserID)
	assert.ErrorIs(t, err, quotations.ErrNotFound)
}

func TestQIR_DeleteRemovesRow(t *testing.T) {
	ctx, repo, qid := newRepoWithQuotation(t)
	created, err := repo.CreateItemRequest(ctx, qid, sampleItemRequest(), seedUserID)
	require.NoError(t, err)

	require.NoError(t, repo.DeleteItemRequest(ctx, created.ID))
	_, err = repo.GetItemRequest(ctx, created.ID)
	assert.ErrorIs(t, err, quotations.ErrNotFound)
}

func TestQIR_DeleteNotFound(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	err := repo.DeleteItemRequest(ctx, 9999999)
	assert.ErrorIs(t, err, quotations.ErrNotFound)
}

func TestQIR_UniqueLineNoEnforced(t *testing.T) {
	ctx, repo, qid := newRepoWithQuotation(t)
	_, err := repo.CreateItemRequest(ctx, qid, sampleItemRequest(), seedUserID)
	require.NoError(t, err)

	dup := sampleItemRequest()
	dup.RequestText = "different but same line_no"
	_, err = repo.CreateItemRequest(ctx, qid, dup, seedUserID)
	require.Error(t, err)
}
