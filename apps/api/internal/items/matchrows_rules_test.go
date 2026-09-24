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

// One chunk creates a repeated name once.
func TestRepo_MatchRows_AutoCreateDedupsWithinChunk(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))
	name := fmt.Sprintf("Barang Kembar %d", time.Now().UnixNano())

	out, err := repo.MatchRows(ctx, items.MatchRowsRequest{AutoCreate: true, Rows: []items.MatchRowInput{
		{Name: name, Qty: 1},
		{Name: "  " + strings.ToUpper(name) + "\t", Qty: 3},
	}}, 0.99, seedUserID)
	require.NoError(t, err)
	require.Len(t, out, 2)
	for i, r := range out {
		require.NotNil(t, r.Matched, "row %d", i)
		assert.Equal(t, "CREATED", r.Source, "row %d", i)
	}
	assert.Equal(t, out[0].Matched.ItemID, out[1].Matched.ItemID)

	res, err := repo.List(ctx, items.ListFilter{Q: name, Limit: 5})
	require.NoError(t, err)
	assert.Equal(t, int64(1), res.Total, "one catalog row for both lines")
}

// A nameless unmatched row stays empty.
func TestRepo_MatchRows_NamelessRowIsNotCreated(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))

	out, err := repo.MatchRows(ctx, items.MatchRowsRequest{AutoCreate: true, Rows: []items.MatchRowInput{
		{IMPACode: uniqueIMPA(), Name: "   ", Qty: 1},
	}}, 0.5, seedUserID)
	require.NoError(t, err)
	require.Len(t, out, 1)
	assert.Nil(t, out[0].Matched)
	assert.Equal(t, "NONE", out[0].Source)
}
