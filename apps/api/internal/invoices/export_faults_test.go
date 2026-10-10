package invoices_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// noBuyerExec loses the buyer rows.
// The bulk buyer read comes back empty, as when a client is gone between
// the list read and the buyer read.
type noBuyerExec struct {
	db.Executor
	sql string
}

func (e noBuyerExec) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	if sql == e.sql {
		return e.Executor.Query(ctx, sql, []int64{})
	}
	return e.Executor.Query(ctx, sql, args...)
}

// Reminder read failures are 500.
// The list reads, then the contacts to remind fail: the export is refused
// whole instead of going out without them.
func TestHandler_ExportReminderFaults(t *testing.T) {
	_, tx := testutil.BeginTx(t)
	deliveredPOWithInvoice(t, tx)
	cases := []struct {
		name string
		exec db.Executor
	}{
		// Count and rows pass; the contact query fails.
		{"contact query", &testutil.CountingExec{Inner: tx, FailAfter: 2}},
		// The list rows stream; the contact stream drops.
		{"contact stream", &testutil.BrokenStreamExec{Inner: tx, Skip: 1}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := serve(coretaxRouter(t, tc.exec, coretaxSettings, ""), "/invoices/export.xlsx")
			require.Equal(t, http.StatusInternalServerError, rec.Code, rec.Body.String())
			assert.Equal(t, "internal server error", problemDetail(t, rec))
		})
	}
}

// Missing buyer refuses the workbook.
// An invoice whose buyer row is gone fails the bulk export instead of
// filing a faktur with a blank buyer.
func TestCoretaxXLSX_MissingBuyer(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	require.NoError(t, testutil.ResetCommercialDomain(ctx, tx))
	deliveredPOWithInvoice(t, tx)
	exec := noBuyerExec{Executor: tx, sql: testutil.Store(t).Get("clients.get_by_ids")}

	rec := serve(coretaxRouter(t, exec, coretaxSettings, templatesRoot(t)), "/invoices/coretax.xlsx")
	require.Equal(t, http.StatusInternalServerError, rec.Code, rec.Body.String())
	assert.Equal(t, "internal server error", problemDetail(t, rec))
}

// Reminder reads surface failures.
func TestRepo_ReminderContactsFaults(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)
	store := testutil.Store(t)
	cases := []struct {
		name string
		exec db.Executor
	}{
		{"query", testutil.FakeExec{}},
		{"stream", &testutil.BrokenStreamExec{Inner: tx}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := invoices.NewRepo(tc.exec, store).ReminderContacts(ctx, []int64{invID})
			assert.ErrorIs(t, err, testutil.ErrFake)
			assert.ErrorContains(t, err, "reminder contacts")
		})
	}
}
