package items_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const (
	seedUserID   int64 = 1
	seedItemID   int64 = 9000001
	seedVendorID int64 = 1
)

func ptrI16(v int16) *int16 { return &v }
func ptrS(s string) *string { return &s }

func TestRepo_List(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))

	res, err := repo.List(ctx, items.ListFilter{Limit: 50})
	require.NoError(t, err)
	assert.NotEmpty(t, res.Rows)
	assert.Greater(t, res.Total, int64(0))
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
	assert.True(t, it.IsActive)
}

func TestRepo_Create_Inactive(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))

	inactive := false
	it, err := repo.Create(ctx, items.CreateItemRequest{
		Name:     "INACTIVE ITEM",
		IsActive: &inactive,
	}, seedUserID)
	require.NoError(t, err)
	assert.False(t, it.IsActive)
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

func TestRepo_SearchVendorOffers(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))

	hits, err := repo.SearchVendorOffers(ctx, "bearing", 5)
	require.NoError(t, err)
	_ = hits
}

// Advanced search reads is_active from the catalog, so a deactivated item
// surfaced by the vendor-offer layer must come back false.
func TestRepo_ItemMetaByIDs(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))

	inactive := false
	off, err := repo.Create(ctx, items.CreateItemRequest{
		Name:     "FLAG TEST INACTIVE",
		IsActive: &inactive,
	}, seedUserID)
	require.NoError(t, err)
	on, err := repo.Create(ctx, items.CreateItemRequest{Name: "FLAG TEST ACTIVE"}, seedUserID)
	require.NoError(t, err)

	meta, err := repo.ItemMetaByIDs(ctx, []int64{on.ID, off.ID, 99999999})
	require.NoError(t, err)
	assert.True(t, meta[on.ID].Active)
	assert.False(t, meta[off.ID].Active)
	assert.Equal(t, "FLAG TEST ACTIVE", meta[on.ID].Name, "meta must carry the catalog name")
	assert.NotContains(t, meta, int64(99999999), "absent row must not be reported")
}

// Root cause of the fabricated badge: the vendor-offer layer has no item-level
// is_active filter, so a deactivated item is reachable through it and must be
// reported as inactive rather than assumed active.
func TestRepo_SearchVendorOffers_SurfacesInactiveItem(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))

	inactive := false
	it, err := repo.Create(ctx, items.CreateItemRequest{
		Name:     "DEACTIVATED VENDOR OFFER ITEM",
		IsActive: &inactive,
	}, seedUserID)
	require.NoError(t, err)

	const sku = "ZZQXSKU12345"
	_, err = repo.AddVendor(ctx, it.ID, items.AddVendorToItemRequest{
		VendorID:  seedVendorID,
		VendorSKU: ptrS(sku),
		CostPrice: ptrS("1000"),
	}, seedUserID)
	require.NoError(t, err)

	hits, err := repo.SearchVendorOffers(ctx, sku, 10)
	require.NoError(t, err)
	found := false
	for _, h := range hits {
		if h.ItemID == it.ID {
			found = true
		}
	}
	require.True(t, found, "vendor-offer layer must surface the deactivated item")

	meta, err := repo.ItemMetaByIDs(ctx, []int64{it.ID})
	require.NoError(t, err)
	assert.False(t, meta[it.ID].Active, "enrichment must report the item as inactive")
	assert.Equal(t, "DEACTIVATED VENDOR OFFER ITEM", meta[it.ID].Name,
		"enrichment must backfill the name for a vendor-offer-only hit")
}

func TestRepo_ItemMetaByIDs_Empty(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))

	meta, err := repo.ItemMetaByIDs(ctx, nil)
	require.NoError(t, err)
	assert.Empty(t, meta)
}

func TestRepo_SearchRequestHistory(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))

	hits, err := repo.SearchRequestHistory(ctx, "bearing", 5)
	require.NoError(t, err)
	_ = hits
}
