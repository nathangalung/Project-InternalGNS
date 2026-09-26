package items_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// DB failures stay generic.
func TestHandler_DBFailureIsGenericProblem(t *testing.T) {
	srv := mountedSrv(t, testutil.FakeExec{})
	cases := []struct {
		name   string
		method string
		path   string
		body   any
	}{
		{"update", http.MethodPut, "/items/1", items.UpdateItemRequest{Name: "Gagal", IsActive: true}},
		{"add vendor", http.MethodPost, "/items/1/vendors", items.AddVendorToItemRequest{VendorID: 1}},
		{"image upload url", http.MethodGet, "/items/1/image/upload-url?fileName=a.jpg", nil},
		{"image download url", http.MethodGet, "/items/1/image/download-url", nil},
		{"image attach", http.MethodPatch, "/items/1/image", items.UpdateImageRequest{ObjectKey: "items/1/a.jpg"}},
		// The pool cannot begin, so the import refuses to run unguarded.
		{"match rows without tx", http.MethodPost, "/items/match-rows",
			items.MatchRowsRequest{Rows: []items.MatchRowInput{{Name: "Baut"}}}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := doJSON(t, srv, c.method, c.path, c.body)
			defer res.Body.Close()
			assertInternalProblem(t, res)
		})
	}
}

// Read fails after parent.
func TestHandler_SecondQueryFailure(t *testing.T) {
	it := createItem(t, items.CreateItemRequest{Name: uniqueItemName("FAULT")})
	id := itoa(it.ID)
	cases := []struct {
		name   string
		method string
		path   string
		body   any
	}{
		{"list data after count", http.MethodGet, "/items/?q=a", nil},
		{"vendors after parent", http.MethodGet, "/items/" + id + "/vendors", nil},
		{"price history after parent", http.MethodGet, "/items/" + id + "/price-history", nil},
		{"image key after parent", http.MethodPatch, "/items/" + id + "/image",
			items.UpdateImageRequest{ObjectKey: "items/" + id + "/a.jpg"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			exec := &testutil.CountingExec{Inner: testutil.Pool(t), FailAfter: 1}
			res := doJSON(t, mountedSrv(t, exec), c.method, c.path, c.body)
			defer res.Body.Close()
			assertInternalProblem(t, res)
		})
	}
}

// Recheck failure is not inactive.
func TestRepo_AddVendor_RecheckFailureIsNotInactive(t *testing.T) {
	it := createItem(t, items.CreateItemRequest{Name: uniqueItemName("RECHECK")})
	vendorID := createVendor(t, false)
	exec := &testutil.CountingExec{Inner: testutil.Pool(t), FailAfter: 1}
	repo := items.NewRepo(exec, testutil.Store(t))

	_, err := repo.AddVendor(context.Background(), it.ID, items.AddVendorToItemRequest{VendorID: vendorID}, seedUserID)
	require.ErrorIs(t, err, testutil.ErrFake)
	assert.NotErrorIs(t, err, items.ErrVendorInactive)
	assert.NotErrorIs(t, err, items.ErrVendorNotFound)
}

// Import errors name their stage.
func TestRepo_MatchRows_FailureNamesStage(t *testing.T) {
	cases := []struct {
		budget int
		want   string
	}{
		{0, "match row 0 by IMPA"},
		{1, "match rows 0-1 by name"},
		{2, "price row 0"},
		{3, "create row 1"},
		{4, "price row 1"},
	}
	for _, c := range cases {
		t.Run(c.want, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			store := testutil.Store(t)
			impa := uniqueIMPA()
			_, err := items.NewRepo(tx, store).Create(ctx,
				items.CreateItemRequest{Name: uniqueItemName("STAGE"), IMPACode: &impa}, seedUserID)
			require.NoError(t, err)

			left := c.budget
			repo := items.NewRepo(flakyTx{Tx: tx, left: &left}, store)
			req := items.MatchRowsRequest{AutoCreate: true, Rows: []items.MatchRowInput{
				{IMPACode: impa, Name: "apa saja", Qty: 1},
				{Name: uniqueItemName("STAGE NEW"), Qty: 1},
			}}
			_, err = repo.MatchRows(ctx, req, 0.99, seedUserID)
			require.ErrorIs(t, err, errFlaky)
			assert.Contains(t, err.Error(), c.want)
		})
	}
}

// Repo surfaces executor failures.
func TestRepo_MoreErrorPaths(t *testing.T) {
	r := items.NewRepo(testutil.FakeExec{}, testutil.Store(t))
	ctx := context.Background()
	cases := []struct {
		name string
		want error
		call func() error
	}{
		{"update", testutil.ErrFake, func() error {
			_, err := r.Update(ctx, 1, items.UpdateItemRequest{Name: "x"}, 1)
			return err
		}},
		{"update image", testutil.ErrFake, func() error { return r.UpdateImage(ctx, 1, "items/1/a.jpg", 1) }},
		{"add vendor", testutil.ErrFake, func() error {
			_, err := r.AddVendor(ctx, 1, items.AddVendorToItemRequest{VendorID: 1}, 1)
			return err
		}},
		{"item meta", testutil.ErrFake, func() error { _, err := r.ItemMetaByIDs(ctx, []int64{1}); return err }},
		{"find by impa", testutil.ErrFake, func() error { _, err := r.FindByIMPA(ctx, "X"); return err }},
		{"match with vendor", testutil.ErrFake, func() error { _, err := r.MatchWithVendorByID(ctx, 1); return err }},
		{"match rows without tx", items.ErrNoTx, func() error {
			_, err := r.MatchRows(ctx, items.MatchRowsRequest{}, 0.5, 1)
			return err
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			assert.ErrorIs(t, c.call(), c.want)
		})
	}
}

// Missing item has no match.
func TestRepo_MatchWithVendorByID_Missing(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, err := items.NewRepo(tx, testutil.Store(t)).MatchWithVendorByID(ctx, 999999999)
	assert.ErrorIs(t, err, items.ErrNotFound)
}
