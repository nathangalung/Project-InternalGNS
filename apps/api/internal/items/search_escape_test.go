package items_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// LIKE metacharacters match literally.
func TestRepo_List_EscapesLikeWildcards(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))

	nonce := uniqueItemName("ESC")
	literal, err := repo.Create(ctx, items.CreateItemRequest{Name: "PCT%ONE " + nonce}, seedUserID)
	require.NoError(t, err)
	_, err = repo.Create(ctx, items.CreateItemRequest{Name: "PCTXONE " + nonce}, seedUserID)
	require.NoError(t, err)
	under, err := repo.Create(ctx, items.CreateItemRequest{Name: "UND_TWO " + nonce}, seedUserID)
	require.NoError(t, err)
	_, err = repo.Create(ctx, items.CreateItemRequest{Name: "UNDXTWO " + nonce}, seedUserID)
	require.NoError(t, err)
	slash, err := repo.Create(ctx, items.CreateItemRequest{Name: `BS\ONE ` + nonce}, seedUserID)
	require.NoError(t, err)
	_, err = repo.Create(ctx, items.CreateItemRequest{Name: "BSONE " + nonce}, seedUserID)
	require.NoError(t, err)

	tests := []struct {
		name  string
		query string
		want  int64
	}{
		{"percent is literal", "PCT%ONE " + nonce, literal.ID},
		{"underscore is literal", "UND_TWO " + nonce, under.ID},
		{"backslash is literal", `BS\ONE ` + nonce, slash.ID},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res, err := repo.List(ctx, items.ListFilter{Q: tt.query, Limit: 50})
			require.NoError(t, err)
			require.Len(t, res.Rows, 1, "rows=%+v", res.Rows)
			assert.Equal(t, tt.want, res.Rows[0].ID)
			assert.Equal(t, int64(1), res.Total)
		})
	}
}

// Lone wildcards sweep nothing.
// They must not pull the whole catalog into fuzzy search.
func TestRepo_SearchCatalog_EscapesLikeWildcards(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))

	tests := []struct {
		name  string
		query string
	}{
		{"percent", "%"},
		{"underscore", "_"},
		{"backslash", `\`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			hits, err := repo.SearchCatalog(ctx, tt.query, 0.3, 50, nil)
			require.NoError(t, err)
			assert.Empty(t, hits)
		})
	}
}

// Import matching escapes wildcards.
// A wildcard is never a catalog-wide match.
func TestRepo_MatchRows_EscapesLikeWildcards(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))

	tests := []struct {
		name  string
		query string
	}{
		{"percent", "%"},
		{"underscore", "_"},
		{"backslash", `\`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out, err := repo.MatchRows(ctx, items.MatchRowsRequest{Rows: []items.MatchRowInput{{Name: tt.query}}}, 0.3, seedUserID)
			require.NoError(t, err)
			require.Len(t, out, 1)
			assert.Nil(t, out[0].Matched)
		})
	}
}

// Search tiers escape wildcards too.
// That covers vendor-offer and request-history.
func TestRepo_SearchTiers_EscapeLikeWildcards(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))

	for _, q := range []string{"%", "_", `\`} {
		offers, err := repo.SearchVendorOffers(ctx, q, 50, nil)
		require.NoError(t, err, "vendor offers q=%q", q)
		assert.Empty(t, offers, "vendor offers q=%q", q)

		history, err := repo.SearchRequestHistory(ctx, q, 50, nil)
		require.NoError(t, err, "request history q=%q", q)
		assert.Empty(t, history, "request history q=%q", q)
	}
}
