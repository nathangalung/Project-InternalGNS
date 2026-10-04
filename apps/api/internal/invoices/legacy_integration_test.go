package invoices_test

import (
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Old invoice numbers answer typed text.
// The period search reads only the current number.
func TestLegacyNo_InvoiceSearchAndRead(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	quotationID, _, invID := deliveredPOWithInvoice(t, tx)
	tag := strconv.FormatInt(time.Now().UnixNano(), 36)
	legacy := "0" + tag + "/1/1998"
	_, err := tx.Exec(ctx, `UPDATE invoices SET legacy_no = $2 WHERE id = $1`, invID, legacy)
	require.NoError(t, err)
	repo := invoices.NewRepo(tx, testutil.Store(t))

	inv, err := repo.GetDetailByQuotation(ctx, quotationID)
	require.NoError(t, err)
	assert.Equal(t, &legacy, inv.LegacyNo)

	for _, tc := range []struct {
		q     string
		found bool
	}{
		{legacy, true},
		{"1/1998", false},
	} {
		res, err := repo.List(ctx, invoices.ListFilter{Q: tc.q, Limit: 100})
		require.NoError(t, err)
		var hit *invoices.Invoice
		for i := range res.Rows {
			if res.Rows[i].ID == invID {
				hit = &res.Rows[i]
			}
		}
		if !tc.found {
			assert.Nil(t, hit, "%q must not find the old number", tc.q)
			continue
		}
		require.NotNil(t, hit, "%q must find the old number", tc.q)
		assert.Equal(t, &legacy, hit.LegacyNo)
	}
}
