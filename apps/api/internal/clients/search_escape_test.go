package clients_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Lone wildcards match nothing extra.
// A lone wildcard must not match every client.
func TestRepo_Search_EscapesLikeWildcards(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := clients.NewRepo(tx, testutil.Store(t))

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
			hits, err := repo.Search(ctx, tt.query, 0.3, 50)
			require.NoError(t, err)
			assert.Empty(t, hits)
		})
	}
}

// List filters escape wildcards.
// They treat a wildcard as literal text.
func TestRepo_List_EscapesLikeWildcards(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := clients.NewRepo(tx, testutil.Store(t))

	all, err := repo.List(ctx, clients.ListFilter{Limit: 50})
	require.NoError(t, err)
	require.NotEmpty(t, all.Rows)

	res, err := repo.List(ctx, clients.ListFilter{Q: "%", Limit: 50})
	require.NoError(t, err)
	assert.Empty(t, res.Rows)
	assert.Equal(t, int64(0), res.Total)
}
