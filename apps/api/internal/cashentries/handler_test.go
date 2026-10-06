package cashentries_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/cashentries"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/rolegate"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/roles"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const seedUserID int64 = 1

// server mounts Kas Lain in a tx.
// Every row a test writes rolls back with it.
func server(t *testing.T, role string) (*httptest.Server, pgx.Tx) {
	t.Helper()
	_, tx := testutil.BeginTx(t)
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			ctx := deps.WithUserRole(deps.WithUserID(req.Context(), seedUserID), role)
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	})
	r.Mount("/cash-entries", cashentries.Routes(deps.Deps{Pool: tx, Queries: testutil.Store(t)}))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv, tx
}

// call sends JSON and reads the body.
func call(t *testing.T, srv *httptest.Server, method, path string, body any, header map[string]string) (int, []byte, http.Header) {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		require.NoError(t, err)
		rdr = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, srv.URL+path, rdr)
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	for k, v := range header {
		req.Header.Set(k, v)
	}
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	require.NoError(t, err)
	return res.StatusCode, raw, res.Header
}

func valid() cashentries.EntryInput {
	return cashentries.EntryInput{
		EntryDate: "2026-09-15", Direction: cashentries.DirectionOut,
		Category: "Sewa Kantor", Amount: "4500000", Description: "Sewa September",
	}
}

func create(t *testing.T, srv *httptest.Server, in cashentries.EntryInput) cashentries.Entry {
	t.Helper()
	code, raw, _ := call(t, srv, http.MethodPost, "/cash-entries/", in, nil)
	require.Equal(t, http.StatusCreated, code, string(raw))
	var e cashentries.Entry
	require.NoError(t, json.Unmarshal(raw, &e))
	return e
}

// Finance input records and corrects.
// A create comes back whole, an edit needs the version read, and a stale
// edit is a version conflict.
func TestHandler_CreateAndEdit(t *testing.T) {
	srv, _ := server(t, roles.FinanceInput)
	e := create(t, srv, cashentries.EntryInput{
		EntryDate: " 2026-09-15 ", Direction: cashentries.DirectionOut,
		Category: "  Sewa Kantor ", Amount: "4500000", Description: " Sewa September ",
	})
	assert.Equal(t, "2026-09-15", e.EntryDate)
	assert.Equal(t, "Sewa Kantor", e.Category, "trimmed")
	assert.Equal(t, "4500000.00", e.Amount)
	assert.Equal(t, "Sewa September", e.Description)
	assert.NotEmpty(t, e.CreatedByName)

	path := "/cash-entries/" + strconv.FormatInt(e.ID, 10)
	edit := valid()
	edit.Amount = "4750000.50"
	code, _, _ := call(t, srv, http.MethodPut, path, edit, nil)
	assert.Equal(t, http.StatusBadRequest, code, "If-Match required")

	version := map[string]string{"If-Match": strconv.Itoa(int(e.RowVersion))}
	code, raw, _ := call(t, srv, http.MethodPut, path, edit, version)
	require.Equal(t, http.StatusOK, code, string(raw))
	var got cashentries.Entry
	require.NoError(t, json.Unmarshal(raw, &got))
	assert.Equal(t, "4750000.50", got.Amount)
	assert.Equal(t, e.RowVersion+1, got.RowVersion)

	code, raw, _ = call(t, srv, http.MethodPut, path, edit, version)
	require.Equal(t, http.StatusConflict, code)
	var p httperr.Error
	require.NoError(t, json.Unmarshal(raw, &p))
	assert.Equal(t, httperr.VersionConflictCode, p.Code)

	code, _, _ = call(t, srv, http.MethodPut, "/cash-entries/999999999", edit, version)
	assert.Equal(t, http.StatusNotFound, code)
	code, _, _ = call(t, srv, http.MethodGet, "/cash-entries/999999999", nil, nil)
	assert.Equal(t, http.StatusNotFound, code)
	code, _, _ = call(t, srv, http.MethodGet, "/cash-entries/x", nil, nil)
	assert.Equal(t, http.StatusBadRequest, code)
}

// Each field is checked.
func TestHandler_RefusesBadInput(t *testing.T) {
	srv, _ := server(t, roles.Finance)
	long := func(n int) string { return string(bytes.Repeat([]byte("a"), n)) }
	tests := []struct {
		name  string
		spoil func(*cashentries.EntryInput)
		field string
		msg   string
	}{
		{"no date", func(in *cashentries.EntryInput) { in.EntryDate = "" }, "entryDate", "Tanggal wajib diisi dengan format yang benar."},
		{"bad date", func(in *cashentries.EntryInput) { in.EntryDate = "15/09/2026" }, "entryDate", "Tanggal wajib diisi dengan format yang benar."},
		{"no direction", func(in *cashentries.EntryInput) { in.Direction = "" }, "direction", "Pilih Masuk atau Keluar."},
		{"no category", func(in *cashentries.EntryInput) { in.Category = "  " }, "category", "Kategori wajib diisi."},
		{"long category", func(in *cashentries.EntryInput) { in.Category = long(61) }, "category", "Kategori paling banyak 60 karakter."},
		{"zero amount", func(in *cashentries.EntryInput) { in.Amount = "0" }, "amount", "Jumlah harus berupa angka lebih dari 0."},
		{"text amount", func(in *cashentries.EntryInput) { in.Amount = "NaN" }, "amount", "Jumlah harus berupa angka lebih dari 0."},
		{"huge amount", func(in *cashentries.EntryInput) { in.Amount = "1e17" }, "amount", "Jumlah terlalu besar."},
		{"no note", func(in *cashentries.EntryInput) { in.Description = "" }, "description", "Keterangan wajib diisi."},
		{"long note", func(in *cashentries.EntryInput) { in.Description = long(501) }, "description", "Keterangan paling banyak 500 karakter."},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			in := valid()
			tt.spoil(&in)
			code, raw, _ := call(t, srv, http.MethodPost, "/cash-entries/", in, nil)
			require.Equal(t, http.StatusUnprocessableEntity, code)
			var p httperr.Error
			require.NoError(t, json.Unmarshal(raw, &p))
			assert.Equal(t, tt.msg, p.Fields[tt.field])
		})
	}
}

// Filters, totals and categories.
// The summary covers every matching entry, not one page.
func TestHandler_ListAndSummary(t *testing.T) {
	srv, _ := server(t, roles.Finance)
	tag := fmt.Sprintf("Kategori Uji %d", seedUserID)
	for _, in := range []cashentries.EntryInput{
		{EntryDate: "2026-08-31", Direction: cashentries.DirectionIn, Category: tag, Amount: "100", Description: "Di luar rentang"},
		{EntryDate: "2026-09-01", Direction: cashentries.DirectionIn, Category: tag, Amount: "1000", Description: "Setoran modal"},
		{EntryDate: "2026-09-10", Direction: cashentries.DirectionOut, Category: tag, Amount: "250.50", Description: "Biaya bank"},
		{EntryDate: "2026-09-30", Direction: cashentries.DirectionOut, Category: tag, Amount: "100", Description: "Listrik"},
	} {
		create(t, srv, in)
	}
	window := "?dateFrom=2026-09-01&dateTo=2026-09-30&category=" + urlQuery(tag)

	code, raw, header := call(t, srv, http.MethodGet, "/cash-entries/"+window+"&limit=2", nil, nil)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, "3", header.Get("X-Total-Count"))
	var rows []cashentries.Entry
	require.NoError(t, json.Unmarshal(raw, &rows))
	require.Len(t, rows, 2)
	assert.Equal(t, "2026-09-30", rows[0].EntryDate, "newest first")

	code, raw, _ = call(t, srv, http.MethodGet, "/cash-entries/summary"+window, nil, nil)
	require.Equal(t, http.StatusOK, code)
	var s cashentries.Summary
	require.NoError(t, json.Unmarshal(raw, &s))
	assert.Equal(t, cashentries.Summary{TotalIn: "1000.00", TotalOut: "350.50", Net: "649.50"}, s)

	code, raw, header = call(t, srv, http.MethodGet, "/cash-entries/?direction=out&q=bank&category="+urlQuery(tag), nil, nil)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, "1", header.Get("X-Total-Count"), string(raw))

	code, raw, _ = call(t, srv, http.MethodGet, "/cash-entries/categories", nil, nil)
	require.Equal(t, http.StatusOK, code)
	var cats []string
	require.NoError(t, json.Unmarshal(raw, &cats))
	assert.Contains(t, cats, tag)
}

// Only a head deletes or exports.
func TestHandler_HeadOnlyRoutes(t *testing.T) {
	srv, tx := server(t, roles.FinanceInput)
	e := create(t, srv, valid())
	path := "/cash-entries/" + strconv.FormatInt(e.ID, 10)
	for _, p := range []struct{ method, path string }{
		{http.MethodDelete, path},
		{http.MethodGet, "/cash-entries/export.xlsx"},
	} {
		code, raw, _ := call(t, srv, p.method, p.path, nil, nil)
		require.Equal(t, http.StatusForbidden, code)
		var prob httperr.Error
		require.NoError(t, json.Unmarshal(raw, &prob))
		assert.Equal(t, rolegate.RefusedDetail, prob.Detail)
	}

	head := httptest.NewServer(headRouter(t, tx))
	t.Cleanup(head.Close)
	code, raw, header := call(t, head, http.MethodGet, "/cash-entries/export.xlsx", nil, nil)
	require.Equal(t, http.StatusOK, code)
	assert.Contains(t, header.Get("Content-Type"), "spreadsheetml")
	assert.Equal(t, "PK", string(raw[:2]))

	code, _, _ = call(t, head, http.MethodDelete, path, nil, nil)
	assert.Equal(t, http.StatusNoContent, code)
	code, _, _ = call(t, head, http.MethodDelete, path, nil, nil)
	assert.Equal(t, http.StatusNotFound, code)
}

// headRouter mounts as the finance head.
func headRouter(t *testing.T, tx pgx.Tx) http.Handler {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			ctx := deps.WithUserRole(deps.WithUserID(req.Context(), seedUserID), roles.Finance)
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	})
	r.Mount("/cash-entries", cashentries.Routes(deps.Deps{Pool: tx, Queries: testutil.Store(t)}))
	return r
}

func urlQuery(s string) string {
	return (&url.URL{Path: s}).EscapedPath()
}

func TestDirectionLabel(t *testing.T) {
	assert.Equal(t, "Masuk", cashentries.DirectionLabel(cashentries.DirectionIn))
	assert.Equal(t, "Keluar", cashentries.DirectionLabel(cashentries.DirectionOut))
}

// Malformed requests stop early.
func TestHandler_MalformedRequests(t *testing.T) {
	srv, _ := server(t, roles.Finance)
	version := map[string]string{"If-Match": "1"}
	raw := func(method, path, body string, header map[string]string) int {
		req, err := http.NewRequest(method, srv.URL+path, bytes.NewBufferString(body))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		for k, v := range header {
			req.Header.Set(k, v)
		}
		res, err := srv.Client().Do(req)
		require.NoError(t, err)
		res.Body.Close()
		return res.StatusCode
	}
	assert.Equal(t, http.StatusBadRequest, raw(http.MethodPost, "/cash-entries/", "{", nil))
	assert.Equal(t, http.StatusBadRequest, raw(http.MethodPut, "/cash-entries/1", "{", version))
	assert.Equal(t, http.StatusBadRequest, raw(http.MethodPut, "/cash-entries/0", "{}", version))
	assert.Equal(t, http.StatusBadRequest, raw(http.MethodDelete, "/cash-entries/x", "", nil))
	assert.Equal(t, http.StatusUnprocessableEntity, raw(http.MethodPut, "/cash-entries/1", "{}", version))
}
