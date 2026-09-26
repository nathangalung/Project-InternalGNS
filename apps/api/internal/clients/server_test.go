package clients_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/storage"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Clients routes over any executor.
//
// Storage is a bare client: presigning only builds the proxy path, so the
// logo routes run without MinIO.
func mountedSrv(t *testing.T, exec db.Executor) *httptest.Server {
	t.Helper()
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			next.ServeHTTP(w, req.WithContext(deps.WithUserID(req.Context(), seedUserID)))
		})
	})
	r.Mount("/clients", clients.Routes(deps.Deps{
		Pool: exec, Queries: testutil.Store(t), Storage: &storage.Client{},
	}))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

// A 500 that leaks nothing.
func assertInternalProblem(t *testing.T, res *http.Response) {
	t.Helper()
	assert.Equal(t, http.StatusInternalServerError, res.StatusCode)
	assert.Equal(t, "application/problem+json", res.Header.Get("Content-Type"))
	var p httperr.Error
	require.NoError(t, json.NewDecoder(res.Body).Decode(&p))
	assert.Equal(t, "internal server error", p.Detail)
}

func itoa(id int64) string { return strconv.FormatInt(id, 10) }
