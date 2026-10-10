package clients_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/roles"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Broken streams stay generic.
// A result stream that drops after the query started is a 500 that leaks
// nothing, never a page built from the rows read so far.
func TestHandler_BrokenStreams(t *testing.T) {
	id := itoa(newClient(t))
	cases := []struct {
		name string
		path string
		skip int
	}{
		{"list rows", "/clients/?q=PT", 0},
		{"recent quotations after parent", "/clients/" + id + "/quotations", 1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			exec := &testutil.BrokenStreamExec{Inner: testutil.Pool(t), Skip: c.skip}
			res := doJSON(t, mountedSrv(t, exec), http.MethodGet, c.path, nil)
			defer res.Body.Close()
			assertInternalProblem(t, res)
		})
	}
}

// Repo stream failures surface.
func TestRepo_BrokenStreams(t *testing.T) {
	r := clients.NewRepo(&testutil.BrokenStreamExec{Inner: testutil.Pool(t)}, testutil.Store(t))
	ctx := context.Background()

	list, err := r.List(ctx, clients.ListFilter{Limit: 10})
	assert.ErrorIs(t, err, testutil.ErrFake)
	assert.NotNil(t, list.Rows, "a failed page is still a list")
	_, err = r.GetByIDs(ctx, []int64{1})
	assert.ErrorIs(t, err, testutil.ErrFake)
	_, err = r.RecentQuotations(ctx, 1)
	assert.ErrorIs(t, err, testutil.ErrFake)
}

// Contact gone at save is ErrNotFound.
// The handler reads the contact first, so only the repo sees an update
// that matches no row.
func TestRepo_UpdateContact_Missing(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, err := clients.NewRepo(tx, testutil.Store(t)).UpdateContact(ctx, 999999999, 999999999,
		clients.UpdateContactRequest{Name: "Tidak Ada", Phone: &errPhone}, seedUserID)
	assert.ErrorIs(t, err, clients.ErrNotFound)
}

// Save fails after the read.
// The stored contact loads, then the update itself fails: a 500, not a 404
// or a field error.
func TestHandler_UpdateContact_SaveFault(t *testing.T) {
	clientID := newClient(t)
	c := seedContact(t, clientID)
	exec := &testutil.CountingExec{Inner: testutil.Pool(t), FailAfter: 1}
	res := doJSON(t, mountedSrv(t, exec), http.MethodPatch, contactPath(clientID, c.ID),
		map[string]any{"name": "Kontak Gagal"})
	defer res.Body.Close()
	assertInternalProblem(t, res)
}

// Recent quotation totals per role.
// Operational input sees the quotations but never their grand total.
func TestHandler_RecentQuotations_ByRole(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	d := testutil.SeedQuotationHistory(t, ctx, tx, "sent")
	cases := []struct {
		role  string
		total bool
	}{
		{roles.Superadmin, true},
		{roles.OperationalInput, false},
	}
	for _, c := range cases {
		t.Run(c.role, func(t *testing.T) {
			res := doJSON(t, roleSrv(t, tx, c.role), http.MethodGet, "/clients/"+itoa(d.Client)+"/quotations", nil)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			var rows []map[string]any
			require.NoError(t, json.NewDecoder(res.Body).Decode(&rows))
			require.Len(t, rows, 1)
			assert.Equal(t, float64(d.Quotations[0]), rows[0]["id"])
			if c.total {
				assert.Equal(t, "333.00", rows[0]["grandTotal"])
			} else {
				assert.NotContains(t, rows[0], "grandTotal")
			}
		})
	}
}

// roleSrv mounts clients as role.
func roleSrv(t *testing.T, tx pgx.Tx, role string) *httptest.Server {
	t.Helper()
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			ctx := deps.WithUserRole(deps.WithUserID(req.Context(), seedUserID), role)
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	})
	r.Mount("/clients", clients.Routes(deps.Deps{Pool: tx, Queries: testutil.Store(t)}))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}
