package units_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/units"
)

func TestRepo_ListAll(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := units.NewRepo(tx, testutil.Store(t))

	rows, err := repo.ListAll(ctx)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, len(rows), 33)

	codes := map[string]bool{}
	for _, u := range rows {
		codes[u.Code] = true
	}
	assert.True(t, codes["KG"], "KG unit must exist")
	assert.True(t, codes["SET"], "SET unit must exist")
}
