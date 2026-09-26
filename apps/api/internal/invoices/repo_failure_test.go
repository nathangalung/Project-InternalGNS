package invoices_test

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Repo failures surface as errors.
// CountingExec lets the first calls through, so the failure lands on the
// query named in the case.
func TestRepo_FailuresSurface(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)
	store := testutil.Store(t)
	failAfter := func(n int) db.Executor { return &testutil.CountingExec{Inner: tx, FailAfter: n} }
	stale := int32(999)

	cases := []struct {
		name string
		exec db.Executor
		run  func(r *invoices.Repo) error
		want error
	}{
		{name: "list count", exec: failAfter(0), want: testutil.ErrFake,
			run: func(r *invoices.Repo) error { _, err := r.List(ctx, invoices.ListFilter{Limit: 10}); return err }},
		{name: "list rows", exec: failAfter(1), want: testutil.ErrFake,
			run: func(r *invoices.Repo) error { _, err := r.List(ctx, invoices.ListFilter{Limit: 10}); return err }},
		{name: "detail", exec: failAfter(0), want: testutil.ErrFake,
			run: func(r *invoices.Repo) error { _, err := r.GetDetail(ctx, invID); return err }},
		{name: "detail history", exec: failAfter(1), want: testutil.ErrFake,
			run: func(r *invoices.Repo) error { _, err := r.GetDetail(ctx, invID); return err }},
		{name: "items", exec: failAfter(0), want: testutil.ErrFake,
			run: func(r *invoices.Repo) error { _, err := r.ListItems(ctx, invID); return err }},
		{name: "bulk items", exec: failAfter(0), want: testutil.ErrFake,
			run: func(r *invoices.Repo) error { _, err := r.ListItemsBulk(ctx, []int64{invID}); return err }},
		{name: "overdue probe", exec: failAfter(0), want: testutil.ErrFake,
			run: func(r *invoices.Repo) error {
				return r.ChangeStatus(ctx, invID, invoices.ChangeStatusRequest{Status: invoices.StatusOverdue}, seedUserID)
			}},
		{name: "dates refusal probe", exec: failAfter(1), want: testutil.ErrFake,
			run: func(r *invoices.Repo) error {
				_, err := r.UpdateDates(ctx, invID, invoices.UpdateDatesRequest{}, seedUserID, &stale)
				return err
			}},
		{name: "replacement", exec: failAfter(0), want: testutil.ErrFake,
			run: func(r *invoices.Repo) error { _, err := r.Replace(ctx, invID, seedUserID); return err }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.ErrorIs(t, tc.run(invoices.NewRepo(tc.exec, store)), tc.want)
		})
	}
}

// Unknown ids are ErrNotFound.
func TestRepo_UnknownInvoice(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	r := invoices.NewRepo(tx, testutil.Store(t))
	const missing = int64(99999999)

	cases := []struct {
		name string
		run  func() error
	}{
		{"by quotation", func() error { _, err := r.GetByQuotation(ctx, missing); return err }},
		{"detail by quotation", func() error { _, err := r.GetDetailByQuotation(ctx, missing); return err }},
		{"confirm Terlambat", func() error {
			return r.ChangeStatus(ctx, missing, invoices.ChangeStatusRequest{Status: invoices.StatusOverdue}, seedUserID)
		}},
		{"replacement", func() error { _, err := r.Replace(ctx, missing, seedUserID); return err }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.ErrorIs(t, tc.run(), invoices.ErrNotFound)
		})
	}
}

// One live invoice per PO.
func TestCreateInvoice_OneLiveInvoicePerPO(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID, invID := deliveredPOWithInvoice(t, tx)

	var again int64
	require.NoError(t, tx.QueryRow(ctx, `SELECT fn_create_invoice($1, $2)`, poID, seedUserID).Scan(&again))
	assert.Equal(t, invID, again, "a live invoice is returned, not duplicated")

	var n int
	require.NoError(t, tx.QueryRow(ctx, `SELECT count(*) FROM invoices WHERE po_id = $1`, poID).Scan(&n))
	assert.Equal(t, 1, n)
}

// Failed reads are 500.
func TestHandler_ReadFailures(t *testing.T) {
	srv := faultySrv(t)
	for _, path := range []string{"/invoices/export.xlsx", "/invoices/1/items"} {
		t.Run(path, func(t *testing.T) {
			res, err := srv.Client().Get(srv.URL + path)
			require.NoError(t, err)
			defer res.Body.Close()
			assert.Equal(t, http.StatusInternalServerError, res.StatusCode)
		})
	}
}

// Replacement refuses bad ids.
func TestHandler_Replace_BadTarget(t *testing.T) {
	_, tx := testutil.BeginTx(t)
	srv := assetServer(t, tx)
	cases := []struct {
		path   string
		want   int
		detail string
	}{
		{path: "/invoices/abc/replacement", want: http.StatusBadRequest, detail: "invalid id"},
		{path: "/invoices/" + strconv.Itoa(99999999) + "/replacement", want: http.StatusNotFound, detail: "invoice not found"},
	}
	for _, tc := range cases {
		t.Run(tc.path, func(t *testing.T) {
			code, body := call(t, srv, http.MethodPost, tc.path, nil)
			assert.Equal(t, tc.want, code)
			assert.Equal(t, tc.detail, body["detail"])
		})
	}
}

// Broken streams surface as errors.
// A result stream that fails after the query started, as a dropped
// connection does, must reach the caller as an error.
func TestRepo_BrokenStreams(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)
	store := testutil.Store(t)
	broken := func(skip int) *invoices.Repo {
		return invoices.NewRepo(&testutil.BrokenStreamExec{Inner: tx, Skip: skip}, store)
	}

	t.Run("list keeps an empty page", func(t *testing.T) {
		res, err := broken(0).List(ctx, invoices.ListFilter{Limit: 10})
		assert.ErrorIs(t, err, testutil.ErrFake)
		assert.NotNil(t, res.Rows)
		assert.Empty(t, res.Rows)
	})
	cases := []struct {
		name string
		run  func() error
	}{
		{"detail", func() error { _, err := broken(0).GetDetail(ctx, invID); return err }},
		{"detail history", func() error { _, err := broken(1).GetDetail(ctx, invID); return err }},
		{"bulk items", func() error { _, err := broken(0).ListItemsBulk(ctx, []int64{invID}); return err }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.ErrorIs(t, tc.run(), testutil.ErrFake)
		})
	}
}
