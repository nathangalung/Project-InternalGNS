package items_test

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// quotationStatuses spans every quotation status.
// Draft and cancelled never reached the client; the newest five of the rest
// are positions 8, 7, 6, 5 and 4.
var quotationStatuses = []string{"draft", "sent", "accepted", "cancelled", "revision", "rejected", "expired", "sent", "sent"}

// Last quotations of one product.
func TestRepo_RecentQuotations(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	d := testutil.SeedQuotationHistory(t, ctx, tx, quotationStatuses...)
	got, err := items.NewRepo(tx, testutil.Store(t)).RecentQuotations(ctx, d.Item)
	require.NoError(t, err)

	require.Len(t, got, items.RecentQuotationCount)
	ids := make([]int64, 0, len(got))
	for _, r := range got {
		ids = append(ids, r.QuotationID)
	}
	q := d.Quotations
	assert.Equal(t, []int64{q[8], q[7], q[6], q[5], q[4]}, ids, "newest first, drafts and cancelled left out")
	first := got[0]
	assert.Equal(t, "sent", first.Status)
	assert.Equal(t, d.Client, first.ClientID)
	require.NotNil(t, first.ContactName)
	assert.Equal(t, d.Contact, *first.ContactName)
	require.NotNil(t, first.VendorID)
	assert.Equal(t, d.Vendor, *first.VendorID)
	assert.Equal(t, d.VendorName, *first.VendorName)
	assert.Equal(t, "2.00", first.Qty)
	require.NotNil(t, first.CostPrice)
	assert.Equal(t, "100.00", *first.CostPrice)
	assert.Equal(t, "158.00", first.SellingPrice, "the offered line, not the Tidak Ditawarkan one")
	assert.Equal(t, "expired", got[2].Status)
}

// No quotations, empty list.
func TestRepo_RecentQuotations_None(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	d := testutil.SeedQuotationHistory(t, ctx, tx, "draft", "cancelled")
	got, err := items.NewRepo(tx, testutil.Store(t)).RecentQuotations(ctx, d.Item)
	require.NoError(t, err)
	assert.NotNil(t, got)
	assert.Empty(t, got)
}

// The route checks the product.
func TestHandler_RecentQuotations(t *testing.T) {
	srv := newSrv(t)
	it := createItem(t, items.CreateItemRequest{Name: uniqueItemName("RIWAYAT")})
	cases := []struct {
		name string
		path string
		want int
	}{
		{"known product", "/items/" + itoa(it.ID) + "/quotations", http.StatusOK},
		{"bad id", "/items/x/quotations", http.StatusBadRequest},
		{"unknown product", "/items/999999999/quotations", http.StatusNotFound},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := doJSON(t, srv, http.MethodGet, c.path, nil)
			defer res.Body.Close()
			assert.Equal(t, c.want, res.StatusCode)
		})
	}
}
