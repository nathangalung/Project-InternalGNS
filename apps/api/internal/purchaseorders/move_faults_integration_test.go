package purchaseorders_test

import (
	"context"
	"fmt"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// txFaults fails inside the move.
// Begin opens a savepoint on the test transaction whose statements fail
// after failAfter calls; statements outside the move run untouched.
type txFaults struct {
	pgx.Tx
	failAfter int
}

func (f txFaults) Begin(ctx context.Context) (pgx.Tx, error) {
	sp, err := f.Tx.Begin(ctx)
	if err != nil {
		return nil, err
	}
	return countingTx{Tx: sp, c: &testutil.CountingExec{Inner: sp, FailAfter: f.failAfter}}, nil
}

// countingTx counts a savepoint's statements.
type countingTx struct {
	pgx.Tx
	c *testutil.CountingExec
}

func (t countingTx) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	return t.c.Query(ctx, sql, args...)
}

func (t countingTx) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return t.c.QueryRow(ctx, sql, args...)
}

func (t countingTx) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	return t.c.Exec(ctx, sql, args...)
}

// beginFails cannot open the move.
type beginFails struct {
	testutil.FakeExec
	testutil.FakeBeginner
}

// Move failures are generic 500s.
// The lock, the gate read and the move itself each fail inside the one
// transaction, and the PO stays where it was.
func TestHandler_ChangeStatus_MoveFaults(t *testing.T) {
	tests := []struct {
		name      string
		failAfter int
		to        purchaseorders.Status
		note      string
	}{
		{"locking the PO fails", 0, purchaseorders.StatusOnProgress, ""},
		{"the gate read fails", 1, purchaseorders.StatusOnProgress, ""},
		{"the gated move fails", 4, purchaseorders.StatusOnProgress, ""},
		{"an ungated move fails", 1, purchaseorders.StatusCancelled, "Dibatalkan klien"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			_, poID := poAt(t, tx, purchaseorders.StatusUploaded)
			srv := execServer(t, txFaults{Tx: tx, failAfter: tc.failAfter}, "")

			res := doJSON(t, srv, http.MethodPatch, fmt.Sprintf("/purchase-orders/%d/status", poID),
				purchaseorders.ChangeStatusRequest{Status: tc.to, Note: tc.note})
			defer res.Body.Close()
			require.Equal(t, http.StatusInternalServerError, res.StatusCode)
			assert.Equal(t, "internal server error", readProblem(t, res).Detail)

			po, err := purchaseorders.NewRepo(tx, testutil.Store(t)).GetByID(ctx, poID)
			require.NoError(t, err)
			assert.Equal(t, purchaseorders.StatusUploaded, po.Status)
		})
	}

	t.Run("the move cannot begin", func(t *testing.T) {
		srv := execServer(t, beginFails{}, "")
		res := doJSON(t, srv, http.MethodPatch, "/purchase-orders/1/status",
			purchaseorders.ChangeStatusRequest{Status: purchaseorders.StatusOnProgress})
		defer res.Body.Close()
		require.Equal(t, http.StatusInternalServerError, res.StatusCode)
	})
}
