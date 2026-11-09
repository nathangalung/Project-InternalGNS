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

	byCode := map[string]units.Unit{}
	for _, u := range rows {
		byCode[u.Code] = u
		assert.NotNil(t, u.Aliases, "unit %s lists its aliases, none included", u.Code)
	}
	assert.Contains(t, byCode, "KG", "KG unit must exist")
	assert.Contains(t, byCode, "SET", "SET unit must exist")

	cases := []struct {
		code  string
		alias string
	}{
		{"PCS", "PC"},
		{"PCS", "PIECES"},
		{"PCS", "EA"},
		{"RLS", "ROLL"},
		{"TIN", "KALENG"},
		{"CAN", "CANS"},
		{"LBR", "SHEET"},
		{"PKT", "PACK"},
		{"PAIL", "EMBER"},
		{"DRUM", "DRM"},
	}
	for _, c := range cases {
		t.Run(c.code+" "+c.alias, func(t *testing.T) {
			assert.Contains(t, byCode[c.code].Aliases, c.alias)
		})
	}
	assert.Empty(t, byCode["MMBTU"].Aliases)
	assert.NotContains(t, byCode["TIN"].Aliases, "CAN", "CAN is a unit of its own")
	assert.True(t, byCode["CAN"].IsActive)
	assert.False(t, byCode["OTH"].IsActive, "OTH is retired, still listed for what was filed with it")
}
