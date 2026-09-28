package vendors_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/vendors"
)

// List filters escape wildcards.
// They treat a wildcard as literal text.
func TestRepo_List_EscapesLikeWildcards(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := vendors.NewRepo(tx, testutil.Store(t))

	all, err := repo.List(ctx, vendors.ListFilter{Limit: 50})
	require.NoError(t, err)
	require.NotEmpty(t, all.Rows)

	res, err := repo.List(ctx, vendors.ListFilter{Q: "%", Limit: 50})
	require.NoError(t, err)
	assert.Empty(t, res.Rows)
	assert.Equal(t, int64(0), res.Total)
}
