package items_test

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// recFixture is one priced catalog.
type recFixture struct {
	repo                      *items.Repo
	tx                        pgx.Tx
	item, bare, unsold        int64
	cheap, pricey             int64 // vendor ids
	cheapLink, priceyLink     int64 // vendor_products ids
	clientA, clientB, clientC int64
}

func insertVendor(t *testing.T, ctx context.Context, tx pgx.Tx, name string) int64 {
	t.Helper()
	var id int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO vendors (name, created_by, updated_by) VALUES ($1, $2, $2) RETURNING id`,
		name, seedUserID).Scan(&id))
	return id
}

func insertClient(t *testing.T, ctx context.Context, tx pgx.Tx, name string) int64 {
	t.Helper()
	var id int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO company_client (number, name, country_code, created_by, updated_by)
		VALUES (fn_next_client_number(), $1, 'IDN', $2, $2) RETURNING id`,
		name, seedUserID).Scan(&id))
	return id
}

// quote stores one priced line.
// The status and creation time are forced, so the test controls which deal
// is the newest.
func quote(t *testing.T, ctx context.Context, tx pgx.Tx, client, item, link int64,
	sell, status string, at time.Time) {
	t.Helper()
	lines, err := json.Marshal([]map[string]any{{
		"requested_name": "REC LINE", "offered_item_id": item, "vendor_product_id": link,
		"qty": "1", "unit_id": defaultUnitID, "selling_price": sell, "cost_price": "100000",
	}})
	require.NoError(t, err)
	var id int64
	require.NoError(t, tx.QueryRow(ctx, `
		SELECT fn_create_quotation($1, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, $2::jsonb, $3)`,
		client, lines, seedUserID).Scan(&id))
	_, err = tx.Exec(ctx, `UPDATE quotations SET status = $2, created_at = $3 WHERE id = $1`, id, status, at)
	require.NoError(t, err)
}

func newRecFixture(t *testing.T) (context.Context, recFixture) {
	t.Helper()
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))
	f := recFixture{repo: repo, tx: tx}
	mk := func(name string) int64 {
		it, err := repo.Create(ctx, items.CreateItemRequest{Name: uniqueItemName(name)}, seedUserID)
		require.NoError(t, err)
		return it.ID
	}
	f.item, f.bare, f.unsold = mk("REC SOLD"), mk("REC BARE"), mk("REC UNSOLD")
	f.cheap = insertVendor(t, ctx, tx, uniqueItemName("REC CHEAP VENDOR"))
	f.pricey = insertVendor(t, ctx, tx, uniqueItemName("REC PRICEY VENDOR"))
	link := func(item, vendor int64, cost string) int64 {
		v, err := repo.AddVendor(ctx, item, items.AddVendorToItemRequest{VendorID: vendor, CostPrice: &cost}, seedUserID)
		require.NoError(t, err)
		return v.VendorProductID
	}
	f.cheapLink = link(f.item, f.cheap, "100000")
	f.priceyLink = link(f.item, f.pricey, "120000")
	link(f.unsold, f.cheap, "50000")
	f.clientA = insertClient(t, ctx, tx, "REC CLIENT A")
	f.clientB = insertClient(t, ctx, tx, "REC CLIENT B")
	f.clientC = insertClient(t, ctx, tx, "REC CLIENT C")

	base := time.Date(2026, 5, 1, 9, 0, 0, 0, time.UTC)
	quote(t, ctx, tx, f.clientA, f.item, f.priceyLink, "150000", "sent", base)
	quote(t, ctx, tx, f.clientB, f.item, f.cheapLink, "170000", "accepted", base.AddDate(0, 1, 0))
	// Drafts and rejected offers are no deal.
	quote(t, ctx, tx, f.clientA, f.item, f.cheapLink, "999000", "draft", base.AddDate(0, 2, 0))
	quote(t, ctx, tx, f.clientC, f.item, f.cheapLink, "888000", "rejected", base.AddDate(0, 2, 0))
	return ctx, f
}

func strp(s string) *string { return &s }
func i64p(v int64) *int64   { return &v }

func byItem(recs []items.Recommendation) map[int64]items.Recommendation {
	out := map[int64]items.Recommendation{}
	for _, r := range recs {
		out[r.ItemID] = r
	}
	return out
}

// Recommendations follow the agreed rules.
func TestRepo_Recommend(t *testing.T) {
	ctx, f := newRecFixture(t)

	cases := []struct {
		name       string
		client     *int64
		wantVendor *int64
		wantLink   *int64
		wantCost   *string
		wantSell   *string
	}{
		{"client's own vendor and price", i64p(f.clientA), &f.pricey, &f.priceyLink, strp("120000.00"), strp("150000.00")},
		{"other client's price, cheapest vendor", i64p(f.clientC), &f.cheap, &f.cheapLink, strp("100000.00"), strp("170000.00")},
		{"no client at all", nil, &f.cheap, &f.cheapLink, strp("100000.00"), strp("170000.00")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recs, err := f.repo.Recommend(ctx, tc.client, []int64{f.item})
			require.NoError(t, err)
			require.Len(t, recs, 1)
			r := recs[0]
			assert.Equal(t, f.item, r.ItemID)
			assert.Equal(t, tc.wantVendor, r.VendorID)
			assert.Equal(t, tc.wantLink, r.VendorProductID)
			assert.Equal(t, tc.wantCost, r.CostPrice)
			assert.Equal(t, tc.wantSell, r.SellingPrice)
			require.NotNil(t, r.VendorName)
		})
	}
}

// Unsold or unlinked items stay empty.
func TestRepo_Recommend_Gaps(t *testing.T) {
	ctx, f := newRecFixture(t)
	recs, err := f.repo.Recommend(ctx, i64p(f.clientA), []int64{f.bare, f.unsold, 999999999})
	require.NoError(t, err)
	got := byItem(recs)
	require.Len(t, got, 2, "an unknown id has no row")

	bare := got[f.bare]
	assert.Nil(t, bare.VendorID)
	assert.Nil(t, bare.CostPrice)
	assert.Nil(t, bare.SellingPrice)

	unsold := got[f.unsold]
	assert.Equal(t, &f.cheap, unsold.VendorID)
	assert.Equal(t, strp("50000.00"), unsold.CostPrice)
	assert.Nil(t, unsold.SellingPrice, "never sold: the price is set by hand")
}

// An inactive vendor is never recommended.
func TestRepo_Recommend_SkipsInactiveVendor(t *testing.T) {
	ctx, f := newRecFixture(t)
	_, err := f.tx.Exec(ctx, `UPDATE vendors SET is_active = FALSE WHERE id = $1`, f.pricey)
	require.NoError(t, err)
	recs, err := f.repo.Recommend(ctx, i64p(f.clientA), []int64{f.item})
	require.NoError(t, err)
	require.Len(t, recs, 1)
	assert.Equal(t, &f.cheap, recs[0].VendorID, "falls back to the cheapest active vendor")
	assert.Equal(t, strp("150000.00"), recs[0].SellingPrice, "the client's price still holds")
}

// No ids, no query.
func TestRepo_Recommend_Empty(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	recs, err := items.NewRepo(tx, testutil.Store(t)).Recommend(ctx, nil, nil)
	require.NoError(t, err)
	assert.Empty(t, recs)
}

// Bad recommendation queries are refused.
func TestHandler_Recommendations_RefusesBadQueries(t *testing.T) {
	srv := mountedSrv(t, testutil.Pool(t))
	many := make([]string, 501)
	for i := range many {
		many[i] = strconv.Itoa(i + 1)
	}
	cases := []struct {
		name  string
		query string
		field string
	}{
		{"no ids", "", "itemIds"},
		{"blank ids", "?itemIds=", "itemIds"},
		{"not a number", "?itemIds=1,abc", "itemIds"},
		{"zero id", "?itemIds=0", "itemIds"},
		{"too many", "?itemIds=" + strings.Join(many, ","), "itemIds"},
		{"bad client", "?itemIds=1&clientId=x", "clientId"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res := doJSON(t, srv, http.MethodGet, "/items/recommendations"+tc.query, nil)
			defer res.Body.Close()
			require.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
			var p httperr.Error
			require.NoError(t, json.NewDecoder(res.Body).Decode(&p))
			assert.Contains(t, p.Fields, tc.field)
		})
	}
}

// Recommendations come back per item.
func TestHandler_Recommendations(t *testing.T) {
	srv := mountedSrv(t, testutil.Pool(t))
	it := createItem(t, items.CreateItemRequest{Name: uniqueItemName("REC HANDLER")})
	res := doJSON(t, srv, http.MethodGet,
		"/items/recommendations?clientId=1&itemIds="+itoa(it.ID)+",999999999", nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var got []items.Recommendation
	require.NoError(t, json.NewDecoder(res.Body).Decode(&got))
	require.Len(t, got, 1, "an unknown id has no row")
	assert.Equal(t, it.ID, got[0].ItemID)
	assert.Nil(t, got[0].SellingPrice)
}

// Unpriced links lose to priced ones.
// A link saved before its harga beli was known sits at cost 0; it must not
// beat a priced vendor, for the cheapest pick or as the client's own.
func TestRepo_Recommend_PrefersPricedLinks(t *testing.T) {
	ctx, f := newRecFixture(t)
	free := insertVendor(t, ctx, f.tx, uniqueItemName("REC FREE VENDOR"))
	zero := "0"
	link, err := f.repo.AddVendor(ctx, f.item, items.AddVendorToItemRequest{VendorID: free, CostPrice: &zero}, seedUserID)
	require.NoError(t, err)
	// The client's newest deal used the unpriced link.
	quote(t, ctx, f.tx, f.clientA, f.item, link.VendorProductID, "160000", "sent",
		time.Date(2026, 9, 1, 9, 0, 0, 0, time.UTC))

	cases := []struct {
		name     string
		client   *int64
		want     int64
		wantCost string
	}{
		{"cheapest skips the unpriced link", i64p(f.clientC), f.cheap, "100000.00"},
		{"the client keeps its newest priced vendor", i64p(f.clientA), f.pricey, "120000.00"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recs, err := f.repo.Recommend(ctx, tc.client, []int64{f.item})
			require.NoError(t, err)
			require.Len(t, recs, 1)
			assert.Equal(t, &tc.want, recs[0].VendorID)
			assert.Equal(t, &tc.wantCost, recs[0].CostPrice)
		})
	}
}
