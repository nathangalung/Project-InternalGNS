package quotations_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/live"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/roles"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// faultyLiveSrv mounts quotations over FakeExec.
// The hub is live and the role comes from roleHeader, so the live routes
// reach their first database read.
func faultyLiveSrv(t *testing.T) *httptest.Server {
	t.Helper()
	hub := live.NewHub()
	t.Cleanup(hub.Close)
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			role := roles.Superadmin
			if v := req.Header.Get(roleHeader); v != "" {
				role = v
			}
			ctx := deps.WithUserRole(deps.WithUserID(req.Context(), seedUserID), role)
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	})
	r.Mount("/quotations", quotations.Routes(deps.Deps{
		Pool: testutil.FakeExec{}, Tx: testutil.FakeBeginner{}, Queries: testutil.Store(t), Live: hub,
	}))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

// Live route failures stay generic.
// Operational input's saves first read the stored prices they keep; a
// failed read refuses the save instead of writing an unpriced line.
func TestHandler_LiveDatabaseFaults(t *testing.T) {
	srv := faultyLiveSrv(t)
	input := map[string]string{roleHeader: roles.OperationalInput}
	cases := []struct {
		name    string
		method  string
		path    string
		body    any
		headers map[string]string
	}{
		{"unlock", http.MethodDelete, "/quotations/1/locks/header", nil, nil},
		{"events", http.MethodGet, "/quotations/1/events", nil, nil},
		{"input line keeps stored price", http.MethodPut, "/quotations/1/lines/1", offered(), input},
		{"input header keeps stored prices", http.MethodPut, "/quotations/1/header",
			quotations.HeaderRequest{DiscountPct: "0"}, input},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := doJSONWithHeaders(t, srv, c.method, c.path, c.body, c.headers)
			defer res.Body.Close()
			require.Equal(t, http.StatusInternalServerError, res.StatusCode)
			assert.Equal(t, "application/problem+json", res.Header.Get("Content-Type"))
			var p httperr.Error
			require.NoError(t, json.NewDecoder(res.Body).Decode(&p))
			assert.Equal(t, "internal server error", p.Detail)
		})
	}
}
