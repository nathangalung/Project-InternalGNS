package vendors_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/storage"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/vendors"
)

// Vendors routes over any executor.
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
	r.Mount("/vendors", vendors.Routes(deps.Deps{
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

// Inserts one owned vendor row.
func insertVendor(t *testing.T, name, location string, active bool) int64 {
	t.Helper()
	var id int64
	require.NoError(t, testutil.Pool(t).QueryRow(context.Background(), `
		INSERT INTO vendors (name, location, contact_info, is_active, created_by, updated_by)
		VALUES ($1, $2, '{"email":"awal@vendor.local","phone":"0811111111"}', $3, $4, $4)
		RETURNING id`, name, location, active, seedUserID).Scan(&id))
	testutil.NewCleaner(t).Vendor(id)
	return id
}

func vendorPath(id int64, rest string) string {
	return fmt.Sprintf("/vendors/%s%s", strconv.FormatInt(id, 10), rest)
}
