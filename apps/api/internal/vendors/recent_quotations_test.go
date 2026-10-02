package vendors_test

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/vendors"
)

// Last quotations through one vendor.
// Draft and cancelled quotations never reached the client; the newest five
// of the rest are positions 8, 7, 6, 5 and 4.
func TestRepo_RecentQuotations(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	d := testutil.SeedQuotationHistory(t, ctx, tx, "draft", "sent", "accepted", "cancelled", "revision", "rejected", "expired", "sent", "sent")
	got, err := vendors.NewRepo(tx, testutil.Store(t)).RecentQuotations(ctx, d.Vendor)
	require.NoError(t, err)

	require.Len(t, got, vendors.RecentQuotationCount)
	ids := make([]int64, 0, len(got))
	for _, r := range got {
		ids = append(ids, r.QuotationID)
	}
	q := d.Quotations
	assert.Equal(t, []int64{q[8], q[7], q[6], q[5], q[4]}, ids)
	first := got[0]
	assert.Equal(t, "sent", first.Status)
	assert.Equal(t, d.Client, first.ClientID)
	require.NotNil(t, first.ContactName)
	assert.Equal(t, d.Contact, *first.ContactName)
	require.NotNil(t, first.ItemID)
	assert.Equal(t, d.Item, *first.ItemID)
	assert.Equal(t, d.ItemName, first.ItemName)
	require.NotNil(t, first.IMPACode)
	assert.Equal(t, d.ItemImpa, *first.IMPACode)
}

// The route checks the vendor.
func TestHandler_RecentQuotations(t *testing.T) {
	srv := mountedSrv(t, testutil.Pool(t))
	id := insertVendor(t, "CV Riwayat Rute", "Jakarta", true)
	cases := []struct {
		name string
		path string
		want int
	}{
		{"known vendor", vendorPath(id, "/quotations"), http.StatusOK},
		{"bad id", "/vendors/x/quotations", http.StatusBadRequest},
		{"unknown vendor", vendorPath(999999999, "/quotations"), http.StatusNotFound},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res, err := srv.Client().Get(srv.URL + c.path)
			require.NoError(t, err)
			defer res.Body.Close()
			assert.Equal(t, c.want, res.StatusCode)
		})
	}
}

// Failed reads stay generic.
// The parent read and the list read each fail as a 500 that leaks nothing.
func TestHandler_RecentQuotations_Faults(t *testing.T) {
	id := insertVendor(t, "CV Riwayat Gagal", "Jakarta", true)
	cases := []struct {
		name string
		exec db.Executor
	}{
		{"parent read", testutil.FakeExec{}},
		{"list read", &testutil.CountingExec{Inner: testutil.Pool(t), FailAfter: 1}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			srv := mountedSrv(t, c.exec)
			res, err := srv.Client().Get(srv.URL + "/vendors/" + strconv.FormatInt(id, 10) + "/quotations")
			require.NoError(t, err)
			defer res.Body.Close()
			assertInternalProblem(t, res)
		})
	}
}
