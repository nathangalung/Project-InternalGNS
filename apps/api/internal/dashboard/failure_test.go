package dashboard_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/dashboard"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// financeRouter mounts dashboard as finance.
func financeRouter(t *testing.T, exec db.Executor) http.Handler {
	t.Helper()
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			next.ServeHTTP(w, req.WithContext(deps.WithUserRole(req.Context(), "finance")))
		})
	})
	r.Mount("/dashboard", dashboard.Routes(deps.Deps{Pool: exec, Queries: testutil.Store(t)}))
	return r
}

// Export failures map to statuses.
func TestHandler_Export_Failures(t *testing.T) {
	pool := testutil.Pool(t)
	cases := []struct {
		name   string
		exec   db.Executor
		query  string
		want   int
		detail string
	}{
		{name: "year is not a number", exec: pool, query: "?year=abc", want: http.StatusBadRequest, detail: "invalid year"},
		{name: "year past 9999", exec: pool, query: "?year=10000", want: http.StatusBadRequest, detail: "invalid year"},
		{name: "totals read fails", exec: testutil.FakeExec{}, query: "?year=2031", want: http.StatusInternalServerError},
		{name: "series read fails", exec: &testutil.CountingExec{Inner: pool, FailAfter: 1}, query: "?year=2031", want: http.StatusInternalServerError},
		{name: "last series read fails", exec: &testutil.CountingExec{Inner: pool, FailAfter: 5}, query: "?year=2031", want: http.StatusInternalServerError},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			financeRouter(t, tc.exec).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/dashboard/export.xlsx"+tc.query, nil))
			assert.Equal(t, tc.want, rec.Code, rec.Body.String())
			assert.Contains(t, rec.Header().Get("Content-Type"), "application/problem+json")
			if tc.detail != "" {
				var p struct {
					Detail string `json:"detail"`
				}
				require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &p))
				assert.Equal(t, tc.detail, p.Detail)
			}
		})
	}
}

// Tile read failure fails summary.
func TestSummary_TileReadFailure(t *testing.T) {
	exec := &testutil.CountingExec{Inner: testutil.Pool(t), FailAfter: 1}

	_, err := dashboard.NewRepo(exec, testutil.Store(t)).Summary(context.Background())
	assert.ErrorIs(t, err, testutil.ErrFake)

	rec := httptest.NewRecorder()
	exec = &testutil.CountingExec{Inner: testutil.Pool(t), FailAfter: 1}
	financeRouter(t, exec).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/dashboard/summary", nil))
	assert.Equal(t, http.StatusInternalServerError, rec.Code)
}

// Broken streams fail the summary.
func TestSummary_BrokenStreams(t *testing.T) {
	cases := []struct {
		name       string
		skip       int
		rowsBefore int
	}{
		{name: "totals", skip: 0},
		{name: "tile row", skip: 1, rowsBefore: 1},
		{name: "tile stream end", skip: 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			exec := &testutil.BrokenStreamExec{Inner: testutil.Pool(t), Skip: tc.skip, RowsBefore: tc.rowsBefore}
			s, err := dashboard.NewRepo(exec, testutil.Store(t)).Summary(context.Background())
			assert.ErrorIs(t, err, testutil.ErrFake)
			assert.Empty(t, s.QuotationStatuses, "no tiles from a broken read")
		})
	}
}
