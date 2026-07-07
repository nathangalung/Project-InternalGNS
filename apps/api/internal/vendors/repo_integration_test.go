package vendors_test

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/vendors"
)

const (
	seedUserID   int64 = 1
	seedVendorID int64 = 9000001
)

func ptr[T any](v T) *T { return &v }

func TestRepo_List(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := vendors.NewRepo(tx, testutil.Store(t))

	res, err := repo.List(ctx, vendors.ListFilter{Limit: 50})
	require.NoError(t, err)
	assert.NotEmpty(t, res.Rows)
}

func TestRepo_GetByID(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := vendors.NewRepo(tx, testutil.Store(t))

	v, err := repo.GetByID(ctx, seedVendorID)
	require.NoError(t, err)
	assert.Equal(t, seedVendorID, v.ID)
}

func TestRepo_GetByID_NotFound(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := vendors.NewRepo(tx, testutil.Store(t))

	_, err := repo.GetByID(ctx, 99999999)
	assert.ErrorIs(t, err, vendors.ErrNotFound)
}

func TestRepo_Create(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := vendors.NewRepo(tx, testutil.Store(t))

	req := vendors.CreateVendorRequest{
		Name:        "PT Test Vendor",
		Location:    ptr("Bali"),
		ContactInfo: json.RawMessage(`{"email":"test@vendor.local"}`),
	}
	v, err := repo.Create(ctx, req, seedUserID)
	require.NoError(t, err)
	assert.Greater(t, v.ID, int64(0))
	assert.Equal(t, "PT Test Vendor", v.Name)
	assert.True(t, v.IsActive)
}

func TestRepo_Create_Inactive(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := vendors.NewRepo(tx, testutil.Store(t))

	inactive := false
	v, err := repo.Create(ctx, vendors.CreateVendorRequest{
		Name:     "PT Nonaktif",
		IsActive: &inactive,
	}, seedUserID)
	require.NoError(t, err)
	assert.False(t, v.IsActive)
}

func TestRepo_Create_NullContactInfo(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := vendors.NewRepo(tx, testutil.Store(t))

	req := vendors.CreateVendorRequest{
		Name:     "Plain Vendor",
		Location: nil,
	}
	v, err := repo.Create(ctx, req, seedUserID)
	require.NoError(t, err)
	assert.Greater(t, v.ID, int64(0))
}

func TestRepo_Search(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := vendors.NewRepo(tx, testutil.Store(t))

	results, err := repo.Search(ctx, "Toko", 0.05, 5)
	require.NoError(t, err)
	assert.NotEmpty(t, results)
}

func TestRepo_ListItems(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := vendors.NewRepo(tx, testutil.Store(t))

	rows, err := repo.ListItems(ctx, seedVendorID, 50)
	require.NoError(t, err)
	_ = rows
}

func TestRepo_List_IncludesProductCountAndTotalPurchase(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := vendors.NewRepo(tx, testutil.Store(t))

	res, err := repo.List(ctx, vendors.ListFilter{Limit: 200})
	require.NoError(t, err)
	require.NotEmpty(t, res.Rows)
	require.GreaterOrEqual(t, res.Total, int64(len(res.Rows)))
	for _, v := range res.Rows {
		assert.GreaterOrEqual(t, v.ProductCount, int64(0))
		assert.NotEmpty(t, v.TotalPurchase)
	}
}

func TestRepo_GetByID_IncludesProductCountAndTotalPurchase(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := vendors.NewRepo(tx, testutil.Store(t))

	v, err := repo.GetByID(ctx, seedVendorID)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, v.ProductCount, int64(0))
	assert.NotEmpty(t, v.TotalPurchase)
}
