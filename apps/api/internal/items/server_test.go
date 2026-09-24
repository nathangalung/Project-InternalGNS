package items_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/storage"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Items routes over any executor.
//
// Storage is a bare client: presigning only builds the proxy path, so the
// image routes run without MinIO.
func mountedSrv(t *testing.T, exec db.Executor) *httptest.Server {
	t.Helper()
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			next.ServeHTTP(w, req.WithContext(deps.WithUserID(req.Context(), seedUserID)))
		})
	})
	r.Mount("/items", items.Routes(deps.Deps{
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

var errFlaky = errors.New("flaky tx failure")

// flakyTx fails once its budget runs out.
//
// Begin wraps the savepoint too, so a repo that opens its own transaction
// keeps spending the same budget.
type flakyTx struct {
	pgx.Tx
	left *int
}

func (f flakyTx) spend() bool {
	if *f.left == 0 {
		return false
	}
	*f.left--
	return true
}

func (f flakyTx) Begin(ctx context.Context) (pgx.Tx, error) {
	tx, err := f.Tx.Begin(ctx)
	if err != nil {
		return nil, err
	}
	return flakyTx{Tx: tx, left: f.left}, nil
}

func (f flakyTx) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	if !f.spend() {
		return nil, errFlaky
	}
	return f.Tx.Query(ctx, sql, args...)
}

func (f flakyTx) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	if !f.spend() {
		return flakyRow{}
	}
	return f.Tx.QueryRow(ctx, sql, args...)
}

func (f flakyTx) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	if !f.spend() {
		return pgconn.CommandTag{}, errFlaky
	}
	return f.Tx.Exec(ctx, sql, args...)
}

type flakyRow struct{}

func (flakyRow) Scan(...any) error { return errFlaky }
