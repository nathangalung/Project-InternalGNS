package items_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/roles"
	"github.com/nathangalung/internalgns/apps/api/internal/storage"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// failOn fails one named query.
// It keys on the SQL, not a call count, so the search layers that run in
// parallel reach the database untouched.
type failOn struct {
	db.Executor
	sql string
}

func (e failOn) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	if sql == e.sql {
		return nil, testutil.ErrFake
	}
	return e.Executor.Query(ctx, sql, args...)
}

// Late read failures stay generic.
// Each request passes its earlier reads and fails on the one named, a 500
// that leaks nothing.
func TestHandler_LateReadFaults(t *testing.T) {
	pool := testutil.Pool(t)
	store := testutil.Store(t)
	// One catalog hit, so the identity read has an id to load.
	hit := createItem(t, items.CreateItemRequest{Name: uniqueItemName("META")})
	cases := []struct {
		name string
		exec db.Executor
		path string
	}{
		{"search meta after layers",
			failOn{Executor: pool, sql: store.Get("items.active_flags_by_ids")},
			"/items/search-advanced?q=" + url.QueryEscape(hit.Name)},
		{"recommendations", testutil.FakeExec{}, "/items/recommendations?itemIds=1"},
		{"list rows stream", &testutil.BrokenStreamExec{Inner: pool}, "/items/?q=a"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := doJSON(t, mountedSrv(t, c.exec), http.MethodGet, c.path, nil)
			defer res.Body.Close()
			assertInternalProblem(t, res)
		})
	}
}

// Repo stream failures surface.
// A result stream that drops mid-read reaches the caller as an error,
// never as a short or empty result.
func TestRepo_BrokenStreams(t *testing.T) {
	ctx := context.Background()
	store := testutil.Store(t)
	broken := func(rowsBefore int) *items.Repo {
		return items.NewRepo(&testutil.BrokenStreamExec{Inner: testutil.Pool(t), RowsBefore: rowsBefore}, store)
	}

	list, err := broken(0).List(ctx, items.ListFilter{Limit: 10})
	assert.ErrorIs(t, err, testutil.ErrFake)
	assert.NotNil(t, list.Rows, "a failed page is still a list")

	cases := []struct {
		name string
		call func() error
	}{
		{"item meta scan", func() error { _, err := broken(1).ItemMetaByIDs(ctx, []int64{1}); return err }},
		{"recent quotations", func() error { _, err := broken(0).RecentQuotations(ctx, 1); return err }},
		{"recommend", func() error {
			_, err := items.NewRepo(testutil.FakeExec{}, store).Recommend(ctx, nil, []int64{1})
			return err
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := c.call()
			assert.ErrorIs(t, err, testutil.ErrFake)
			assert.NotErrorIs(t, err, items.ErrNotFound)
		})
	}
}

// Auto-created rows keep their IMPA.
// The typed code is stored with the new item, so the next import of the
// same code matches it exactly instead of creating it again.
func TestRepo_MatchRows_AutoCreateKeepsIMPA(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))
	impa := uniqueIMPA()
	row := items.MatchRowInput{IMPACode: impa, Name: uniqueItemName("AUTO IMPA"), Qty: 1}

	first, err := repo.MatchRows(ctx, items.MatchRowsRequest{AutoCreate: true, Rows: []items.MatchRowInput{row}}, 0.99, seedUserID)
	require.NoError(t, err)
	require.Len(t, first, 1)
	assert.Equal(t, "CREATED", first[0].Source)
	require.NotNil(t, first[0].Matched)

	again, err := repo.MatchRows(ctx, items.MatchRowsRequest{AutoCreate: true, Rows: []items.MatchRowInput{row}}, 0.99, seedUserID)
	require.NoError(t, err)
	assert.Equal(t, "IMPA_EXACT", again[0].Source)
	require.NotNil(t, again[0].Matched)
	assert.Equal(t, first[0].Matched.ItemID, again[0].Matched.ItemID)
}

// Product page figures per role.
// Every role sees the quotation; harga beli and harga jual follow the
// role's access.
func TestHandler_RecentQuotations_ByRole(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	d := testutil.SeedQuotationHistory(t, ctx, tx, "sent")
	cases := []struct {
		role    string
		cost    bool
		selling bool
	}{
		{roles.Superadmin, true, true},
		{roles.OperationalInput, true, false},
		{roles.FinanceInput, false, true},
	}
	for _, c := range cases {
		t.Run(c.role, func(t *testing.T) {
			res := doJSON(t, roleSrv(t, tx, c.role), http.MethodGet, "/items/"+itoa(d.Item)+"/quotations", nil)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			var rows []map[string]any
			require.NoError(t, json.NewDecoder(res.Body).Decode(&rows))
			require.Len(t, rows, 1)
			assert.Equal(t, float64(d.Quotations[0]), rows[0]["quotationId"])
			assert.Equal(t, c.cost, rows[0]["costPrice"] != nil, "costPrice")
			assert.Equal(t, c.selling, rows[0]["sellingPrice"] != nil, "sellingPrice")
		})
	}
}

// Cover download names the cover.
func TestHandler_CoverDownload(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	d := testutil.SeedQuotationHistory(t, ctx, tx)
	key := "items/" + itoa(d.Item) + "/cover.webp"
	_, err := tx.Exec(ctx, `UPDATE items SET image_object_key = $2 WHERE id = $1`, d.Item, key)
	require.NoError(t, err)

	res := doJSON(t, roleSrv(t, tx, roles.Superadmin), http.MethodGet, "/items/"+itoa(d.Item)+"/image/download-url", nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var got struct {
		DownloadURL string `json:"downloadUrl"`
	}
	require.NoError(t, json.NewDecoder(res.Body).Decode(&got))
	bucket, gotKey := proxyKey(t, got.DownloadURL)
	assert.Equal(t, storage.BucketItemImages, bucket)
	assert.Equal(t, key, gotKey)
}

// roleSrv mounts items as role.
func roleSrv(t *testing.T, tx pgx.Tx, role string) *httptest.Server {
	t.Helper()
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			ctx := deps.WithUserRole(deps.WithUserID(req.Context(), seedUserID), role)
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	})
	r.Mount("/items", items.Routes(deps.Deps{
		Pool: tx, Queries: testutil.Store(t), Storage: &storage.Client{}, Objects: testutil.StoredObjects{},
	}))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}
