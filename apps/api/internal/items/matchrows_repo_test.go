package items_test

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// An import larger than one chunk.
const bigImport = 250

// Every row keeps its own index and match across chunk boundaries.
func TestRepo_MatchRows_MapsEveryRowAcrossChunks(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))

	code := uniqueIMPA()
	byIMPA, err := repo.Create(ctx, items.CreateItemRequest{Name: uniqueItemName("MR IMPA"), IMPACode: &code}, seedUserID)
	require.NoError(t, err)
	byName, err := repo.Create(ctx, items.CreateItemRequest{Name: uniqueItemName("MR NAME")}, seedUserID)
	require.NoError(t, err)

	nonce := time.Now().UnixNano()
	rows := make([]items.MatchRowInput, bigImport)
	want := make([]int64, bigImport)
	for i := range rows {
		switch i % 3 {
		case 0:
			rows[i] = items.MatchRowInput{IMPACode: code, Name: "ignored", Qty: float64(i)}
			want[i] = byIMPA.ID
		case 1:
			rows[i] = items.MatchRowInput{Name: byName.Name, Qty: float64(i)}
			want[i] = byName.ID
		default:
			rows[i] = items.MatchRowInput{Name: fmt.Sprintf("QQZX%dVV%dKK", i, nonce), Qty: float64(i)}
		}
	}

	out, err := repo.MatchRows(ctx, items.MatchRowsRequest{Rows: rows}, 0.5, seedUserID)
	require.NoError(t, err)
	require.Len(t, out, bigImport)
	for i, got := range out {
		assert.Equal(t, i, got.Index, "row %d index", i)
		assert.Equal(t, rows[i], got.Requested, "row %d echo", i)
		if want[i] == 0 {
			assert.Nil(t, got.Matched, "row %d should not match", i)
			assert.Equal(t, "NONE", got.Source, "row %d source", i)
			continue
		}
		require.NotNil(t, got.Matched, "row %d should match", i)
		assert.Equal(t, want[i], got.Matched.ItemID, "row %d item", i)
	}
	assert.Equal(t, "IMPA_EXACT", out[0].Source)
	assert.Equal(t, "CATALOG_MATCH", out[1].Source)
}

// Auto-create dedups a name across chunks.
func TestRepo_MatchRows_AutoCreateDedupsAcrossChunks(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))

	nonce := time.Now().UnixNano()
	repeated := fmt.Sprintf("Barang Berulang %d", nonce)
	rows := make([]items.MatchRowInput, 150)
	for i := range rows {
		rows[i] = items.MatchRowInput{Name: fmt.Sprintf("QQZX%dVV%dUNIK", i, nonce), Qty: 1}
	}
	rows[3] = items.MatchRowInput{Name: repeated, Qty: 1}
	rows[140] = items.MatchRowInput{Name: "  " + strings.ToLower(repeated) + " ", Qty: 2}

	out, err := repo.MatchRows(ctx, items.MatchRowsRequest{Rows: rows, AutoCreate: true}, 0.99, seedUserID)
	require.NoError(t, err)
	require.Len(t, out, len(rows))
	require.NotNil(t, out[3].Matched)
	require.NotNil(t, out[140].Matched)
	assert.Equal(t, out[3].Matched.ItemID, out[140].Matched.ItemID, "one product per normalised name")

	// A later chunk sees the earlier chunk's product and may fuzzy-match it,
	// so only the product id is pinned for row 140.
	seen := map[int64]bool{}
	for i, r := range out {
		require.NotNil(t, r.Matched, "row %d", i)
		if i != 140 {
			assert.Equal(t, "CREATED", r.Source, "row %d", i)
		}
		seen[r.Matched.ItemID] = true
	}
	assert.Len(t, seen, len(rows)-1, "only the repeated name shares a product")
}

// A failing row rolls the whole import back.
func TestRepo_MatchRows_FailureKeepsNothing(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))

	name := uniqueItemName("MR ROLLBACK")
	rows := []items.MatchRowInput{
		{Name: name, Qty: 1},
		{Name: strings.Repeat("X", 501), Qty: 1}, // overflows items.name
	}
	_, err := repo.MatchRows(ctx, items.MatchRowsRequest{Rows: rows, AutoCreate: true}, 0.99, seedUserID)
	require.Error(t, err)

	res, err := repo.List(ctx, items.ListFilter{Q: name, Limit: 5})
	require.NoError(t, err)
	assert.Zero(t, res.Total, "the first row's product must not survive the failed import")
}
