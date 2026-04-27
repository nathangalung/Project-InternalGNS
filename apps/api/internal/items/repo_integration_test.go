package items_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const (
	seedUserID int64 = 1
	seedItemID int64 = 1
)

func ptrI16(v int16) *int16 { return &v }
func ptrS(s string) *string { return &s }

func TestRepo_List(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))

	rows, err := repo.List(ctx, 50, 0)
	require.NoError(t, err)
	assert.NotEmpty(t, rows)
}

func TestRepo_GetByID(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))

	it, err := repo.GetByID(ctx, seedItemID)
	require.NoError(t, err)
	assert.Equal(t, seedItemID, it.ID)
}

func TestRepo_GetByID_NotFound(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))

	_, err := repo.GetByID(ctx, 99999999)
	assert.ErrorIs(t, err, items.ErrNotFound)
}

func TestRepo_Create(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))

	req := items.CreateItemRequest{
		Name:          "TEST ITEM ANYAR",
		IMPACode:      ptrS("999999"),
		DefaultUnitID: ptrI16(21),
		Description:   ptrS("test description"),
	}
	it, err := repo.Create(ctx, req, seedUserID)
	require.NoError(t, err)
	assert.Greater(t, it.ID, int64(0))
	assert.Equal(t, "TEST ITEM ANYAR", it.Name)
}

func TestRepo_Create_MinimalFields(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))

	req := items.CreateItemRequest{Name: "MINIMAL ITEM"}
	it, err := repo.Create(ctx, req, seedUserID)
	require.NoError(t, err)
	assert.Greater(t, it.ID, int64(0))
}

func TestRepo_Search(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))

	hits, err := repo.Search(ctx, "PUNCHING", 0.05, 5)
	require.NoError(t, err)
	_ = hits
}

func TestRepo_MatchRequest(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))

	matches, err := repo.MatchRequest(ctx, "PUNCHING TOOL", 5)
	require.NoError(t, err)
	_ = matches
}

func TestRepo_ListVendorsForItem(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))

	rows, err := repo.ListVendorsForItem(ctx, seedItemID)
	require.NoError(t, err)
	_ = rows
}

func TestRepo_SuggestSellingPrices(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))

	hist, err := repo.SuggestSellingPrices(ctx, seedItemID, 5)
	require.NoError(t, err)
	_ = hist
}
