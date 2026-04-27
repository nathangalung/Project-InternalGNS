package countries_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/countries"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

func TestRepo_ListAll(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := countries.NewRepo(tx, testutil.Store(t))

	rows, err := repo.ListAll(ctx)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, len(rows), 200, "ISO 3166 set should be loaded")

	idn := false
	for _, c := range rows {
		if c.Code == "IDN" {
			idn = true
			assert.Equal(t, "Indonesia", c.Name)
			assert.Equal(t, "+62", c.DialCode)
		}
	}
	assert.True(t, idn, "IDN must be present")
}
