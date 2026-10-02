package clients_test

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Last quotations to one client.
// Draft and cancelled quotations never reached the client; the newest five
// of the rest are positions 8, 7, 6, 5 and 4.
func TestRepo_RecentQuotations(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	d := testutil.SeedQuotationHistory(t, ctx, tx, "draft", "sent", "accepted", "cancelled", "revision", "rejected", "expired", "sent", "sent")
	got, err := clients.NewRepo(tx, testutil.Store(t)).RecentQuotations(ctx, d.Client)
	require.NoError(t, err)

	require.Len(t, got, clients.RecentQuotationCount)
	ids := make([]int64, 0, len(got))
	for _, r := range got {
		ids = append(ids, r.ID)
	}
	q := d.Quotations
	assert.Equal(t, []int64{q[8], q[7], q[6], q[5], q[4]}, ids)
	first := got[0]
	assert.Equal(t, "sent", first.Status)
	require.NotNil(t, first.ContactName)
	assert.Equal(t, d.Contact, *first.ContactName)
	assert.Equal(t, 1, first.ProductCount, "only offered lines count")
	assert.NotEmpty(t, first.GrandTotal)
	assert.Equal(t, "expired", got[2].Status)
}

// The route checks the client.
func TestHandler_RecentQuotations(t *testing.T) {
	srv := mountedSrv(t, testutil.Pool(t))
	id := newClient(t)
	cases := []struct {
		name string
		path string
		want int
	}{
		{"known client", "/clients/" + itoa(id) + "/quotations", http.StatusOK},
		{"bad id", "/clients/x/quotations", http.StatusBadRequest},
		{"unknown client", "/clients/999999999/quotations", http.StatusNotFound},
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
	id := newClient(t)
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
			res, err := srv.Client().Get(srv.URL + "/clients/" + strconv.FormatInt(id, 10) + "/quotations")
			require.NoError(t, err)
			defer res.Body.Close()
			assertInternalProblem(t, res)
		})
	}
}
