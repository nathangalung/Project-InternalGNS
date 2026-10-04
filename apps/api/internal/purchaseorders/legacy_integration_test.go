package purchaseorders_test

import (
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Old delivery notes answer typed text.
// The period search reads only the current numbers, and a new PO has none.
func TestLegacyDnNo_SearchAndRead(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID := acceptedQuotationWithPO(t, tx)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	fresh, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	assert.Nil(t, fresh.LegacyDnNo)

	legacy := "DO-" + strconv.FormatInt(time.Now().UnixNano(), 36) + "/II/1998"
	_, err = tx.Exec(ctx, `UPDATE purchase_orders SET legacy_dn_no = $2 WHERE id = $1`, poID, legacy)
	require.NoError(t, err)

	po, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	assert.Equal(t, &legacy, po.LegacyDnNo)

	for _, tc := range []struct {
		q     string
		found bool
	}{
		{legacy, true},
		{"II/1998", false},
	} {
		res, err := repo.List(ctx, purchaseorders.ListFilter{Q: tc.q, Limit: 100})
		require.NoError(t, err)
		if tc.found {
			assert.Contains(t, ids(res.Rows), poID, "%q must find the old number", tc.q)
		} else {
			assert.NotContains(t, ids(res.Rows), poID, "%q must not find the old number", tc.q)
		}
	}
}
