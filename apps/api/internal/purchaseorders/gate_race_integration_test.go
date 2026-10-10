package purchaseorders_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// committedPO builds committed POs.
// A race needs a second connection to see the rows, so they cannot live in
// a test transaction; the Cleaner removes them after the test.
func committedPO(t *testing.T, pool *pgxpool.Pool, build func(tx pgx.Tx) int64) int64 {
	t.Helper()
	ctx := context.Background()
	c := testutil.NewCleaner(t)
	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer func() { _ = tx.Rollback(ctx) }()

	poID := build(tx)
	var qID, clientID int64
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT quotation_id, company_client_id FROM purchase_orders WHERE id = $1`, poID).Scan(&qID, &clientID))
	rows, err := tx.Query(ctx,
		`SELECT DISTINCT offered_item_id FROM quotation_items WHERE quotation_id = $1 AND offered_item_id IS NOT NULL`, qID)
	require.NoError(t, err)
	items, err := pgx.CollectRows(rows, pgx.RowTo[int64])
	require.NoError(t, err)
	require.NoError(t, tx.Commit(ctx))

	c.Quotation(qID)
	c.Client(clientID)
	for _, id := range items {
		c.Item(id)
	}
	return poID
}

// holder opens a competing transaction.
// It returns the transaction and its backend pid, so a test can see what
// waits on it.
func holder(t *testing.T, pool *pgxpool.Pool) (pgx.Tx, int32) {
	t.Helper()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	t.Cleanup(func() { _ = tx.Rollback(ctx) })
	var pid int32
	require.NoError(t, tx.QueryRow(ctx, "SELECT pg_backend_pid()").Scan(&pid))
	return tx, pid
}

// deliverBehind races a delivery.
// The request starts while held is open, must wait for it, and finishes once
// held commits.
func deliverBehind(t *testing.T, pool *pgxpool.Pool, srv *httptest.Server, held pgx.Tx, pid int32, poID int64) *http.Response {
	t.Helper()
	ctx := context.Background()
	raw, err := json.Marshal(purchaseorders.ChangeStatusRequest{Status: purchaseorders.StatusDelivered})
	require.NoError(t, err)
	req, err := http.NewRequest(http.MethodPatch, fmt.Sprintf("%s/purchase-orders/%d/status", srv.URL, poID), bytes.NewReader(raw))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")

	type result struct {
		res *http.Response
		err error
	}
	done := make(chan result, 1)
	go func() {
		res, err := srv.Client().Do(req)
		done <- result{res, err}
	}()
	require.Eventually(t, func() bool {
		var waiting bool
		_ = pool.QueryRow(ctx, `SELECT EXISTS (
			SELECT 1 FROM pg_stat_activity WHERE $1 = ANY (pg_blocking_pids(pid)))`, pid).Scan(&waiting)
		return waiting
	}, 5*time.Second, 10*time.Millisecond, "the delivery waits for the competing transaction")
	require.NoError(t, held.Commit(ctx))

	select {
	case r := <-done:
		require.NoError(t, r.err)
		return r.res
	case <-time.After(10 * time.Second):
		t.Fatal("the delivery never finished")
		return nil
	}
}

// requireRefusedFor asserts the gate refusal.
// The PO stays ON_PROGRESS and no invoice is issued.
func requireRefusedFor(t *testing.T, pool *pgxpool.Pool, res *http.Response, poID int64, gap purchaseorders.GapCode) {
	t.Helper()
	defer res.Body.Close()
	require.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
	var p purchaseorders.IncompleteProblem
	readJSON(t, res, &p)
	assert.Equal(t, purchaseorders.IncompleteCode, p.Code)
	var codes []purchaseorders.GapCode
	for _, issue := range p.Issues {
		codes = append(codes, gapCodes(issue)...)
	}
	assert.Contains(t, codes, gap)

	ctx := context.Background()
	var status string
	var invoices int
	require.NoError(t, pool.QueryRow(ctx, `SELECT status FROM purchase_orders WHERE id = $1`, poID).Scan(&status))
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM invoices WHERE po_id = $1`, poID).Scan(&invoices))
	assert.Equal(t, string(purchaseorders.StatusOnProgress), status)
	assert.Zero(t, invoices, "no invoice is issued")
}

// Gate reads the locked status.
// A delivery that starts while the PO is still UPLOADED, behind a move to
// ON_PROGRESS, is judged from ON_PROGRESS once the move commits, so an
// incomplete client still stops it.
func TestHandler_Deliver_GateSeesLockedStatus(t *testing.T) {
	pool := testutil.Pool(t)
	ctx := context.Background()
	poID := committedPO(t, pool, func(tx pgx.Tx) int64 {
		clientID, _ := probeClient(t, tx, "PT Balapan Status")
		_, poID := createQuotation(t, tx, quotations.CreateRequest{
			ValidityDays:    testutil.Validity(),
			CompanyClientID: clientID, DiscountPct: "0",
			Items: []quotations.CreateItem{quoteLine(strPtr("Kapal Uji"))},
		})
		reachStatus(t, tx, poID, purchaseorders.StatusUploaded)
		return poID
	})
	srv := execServer(t, pool, "")

	mover, pid := holder(t, pool)
	_, err := mover.Exec(ctx, `SELECT fn_change_po_status($1, 'ON_PROGRESS', $2, NULL)`, poID, seedUserID)
	require.NoError(t, err)

	res := deliverBehind(t, pool, srv, mover, pid, poID)
	requireRefusedFor(t, pool, res, poID, purchaseorders.GapClientNpwp)
}

// The gate holds the client.
// A client edit that leaves a malformed NPWP while a delivery runs either
// lands before the gate reads the client or waits for the move, so the
// invoice never copies a buyer the gate did not pass.
func TestHandler_Deliver_GateHoldsClient(t *testing.T) {
	pool := testutil.Pool(t)
	ctx := context.Background()
	poID := committedPO(t, pool, func(tx pgx.Tx) int64 { return completePOInProgress(t, tx) })
	srv := execServer(t, pool, "")

	editor, pid := holder(t, pool)
	_, err := editor.Exec(ctx, `UPDATE company_client SET npwp = '123'
		WHERE id = (SELECT company_client_id FROM purchase_orders WHERE id = $1)`, poID)
	require.NoError(t, err)

	res := deliverBehind(t, pool, srv, editor, pid, poID)
	requireRefusedFor(t, pool, res, poID, purchaseorders.GapClientNpwp)
}
