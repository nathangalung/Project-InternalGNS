package vendors_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// linkedVendor inserts a linked vendor.
// The item it offers is a fresh catalog row.
func linkedVendor(t *testing.T, ctx context.Context, exec db.Executor, active bool) (id, itemID, linkID int64, name string) {
	t.Helper()
	name = fmt.Sprintf("CV Salah Input %d", time.Now().UnixNano())
	require.NoError(t, exec.QueryRow(ctx, `
		INSERT INTO vendors (name, is_active, created_by, updated_by) VALUES ($1, $2, $3, $3) RETURNING id`,
		name, active, seedUserID).Scan(&id))
	require.NoError(t, exec.QueryRow(ctx, `
		INSERT INTO items (name, created_by) VALUES ($1, $2) RETURNING id`,
		"Barang "+name, seedUserID).Scan(&itemID))
	require.NoError(t, exec.QueryRow(ctx, `
		INSERT INTO vendor_products (vendor_id, item_id, cost_price, created_by)
		VALUES ($1, $2, 7000, $3) RETURNING id`, id, itemID, seedUserID).Scan(&linkID))
	return id, itemID, linkID, name
}

// quoteLink quotes the link.
// One sent quotation with that many product lines through it.
func quoteLink(t *testing.T, ctx context.Context, exec db.Executor, itemID, linkID int64, lines int) int64 {
	t.Helper()
	var qid int64
	require.NoError(t, exec.QueryRow(ctx, `
		INSERT INTO quotations (quotation_no, company_client_id, company_client_name,
		                        discount_pct, total_produk, total, total_discount,
		                        status, created_by, updated_by)
		VALUES ($1, 1, 'PT. IMC Ship Management', 0, 20000, 20000, 0, 'sent', $2, $2)
		RETURNING id`, fmt.Sprintf("SQ-HAPUS-%d", time.Now().UnixNano()), seedUserID).Scan(&qid))
	for n := 1; n <= lines; n++ {
		_, err := exec.Exec(ctx, `
			INSERT INTO quotation_items (quotation_id, line_number, item_type, requested_name,
			                             offered_item_id, vendor_product_id, qty, unit_id,
			                             selling_price, cost_price, discount_pct, created_by)
			VALUES ($1, $2, 'product', 'Barang', $3, $4, 1, 19, 10000, 7000, 0, $5)`,
			qid, n, itemID, linkID, seedUserID)
		require.NoError(t, err)
	}
	return qid
}

func problemOf(t *testing.T, res *http.Response) httperr.Error {
	t.Helper()
	var p httperr.Error
	require.NoError(t, json.NewDecoder(res.Body).Decode(&p))
	return p
}

// captureLog swaps the default logger.
func captureLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return &buf
}

// Unused vendors go for good.
// Active or not, its links go with it, the items stay in the catalog, and
// the delete is logged with the name.
func TestHandler_Delete_Unused(t *testing.T) {
	for _, active := range []bool{true, false} {
		t.Run(fmt.Sprintf("active=%v", active), func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			srv := mountedSrv(t, tx)
			id, itemID, _, name := linkedVendor(t, ctx, tx, active)
			logs := captureLog(t)

			res := doJSON(t, srv, http.MethodDelete, vendorPath(id, ""), nil)
			res.Body.Close()
			require.Equal(t, http.StatusNoContent, res.StatusCode)

			res = doJSON(t, srv, http.MethodGet, vendorPath(id, ""), nil)
			res.Body.Close()
			assert.Equal(t, http.StatusNotFound, res.StatusCode)
			var links, items int
			require.NoError(t, tx.QueryRow(ctx, `
				SELECT (SELECT COUNT(*) FROM vendor_products WHERE vendor_id = $1),
				       (SELECT COUNT(*) FROM items WHERE id = $2)`, id, itemID).Scan(&links, &items))
			assert.Zero(t, links)
			assert.Equal(t, 1, items)

			var line map[string]any
			require.NoError(t, json.Unmarshal(logs.Bytes(), &line))
			assert.Equal(t, "permanent delete", line["msg"])
			assert.Equal(t, "vendor", line["entity"])
			assert.EqualValues(t, id, line["id"])
			assert.Equal(t, name, line["name"])
			assert.EqualValues(t, seedUserID, line["user_id"])
		})
	}
}

// A used vendor is refused.
// Documents count once however many of their lines use its links.
func TestHandler_Delete_InUse(t *testing.T) {
	cases := []struct {
		name   string
		accept bool
		want   string
	}{
		{"quotation lines", false, "Vendor ini sudah dipakai di 1 quotation. Nonaktifkan saja."},
		{"accepted into a PO", true, "Vendor ini sudah dipakai di 1 quotation dan 1 PO. Nonaktifkan saja."},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			srv := mountedSrv(t, tx)
			id, itemID, linkID, _ := linkedVendor(t, ctx, tx, true)
			qid := quoteLink(t, ctx, tx, itemID, linkID, 2)
			if tc.accept {
				_, err := tx.Exec(ctx, `SELECT fn_change_quotation_status($1, 'accepted', $2)`, qid, seedUserID)
				require.NoError(t, err)
			}

			res := doJSON(t, srv, http.MethodDelete, vendorPath(id, ""), nil)
			defer res.Body.Close()
			require.Equal(t, http.StatusConflict, res.StatusCode)
			p := problemOf(t, res)
			assert.Equal(t, httperr.InUseCode, p.Code)
			assert.Equal(t, tc.want, p.Detail)

			var links int
			require.NoError(t, tx.QueryRow(ctx,
				`SELECT COUNT(*) FROM vendor_products WHERE vendor_id = $1`, id).Scan(&links))
			assert.Equal(t, 1, links)
		})
	}
}

// Missing or malformed ids.
func TestHandler_Delete_BadTarget(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodDelete, "/vendors/999999999", nil)
	res.Body.Close()
	assert.Equal(t, http.StatusNotFound, res.StatusCode)

	res = doJSON(t, srv, http.MethodDelete, "/vendors/abc", nil)
	res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

// A line saving now wins.
// The line's uncommitted insert holds a key lock on the link, not on the
// vendor, so only the link lock catches it: the delete is refused at once
// with a retryable 409, and goes through once that save is gone.
func TestHandler_Delete_RacesALineSave(t *testing.T) {
	ctx := context.Background()
	pool := testutil.Pool(t)
	id, itemID, linkID, _ := linkedVendor(t, ctx, pool, true)
	cleaner := testutil.NewCleaner(t)
	cleaner.Vendor(id)
	cleaner.Item(itemID)
	srv := newSrv(t)

	ctx, tx := testutil.BeginTx(t)
	quoteLink(t, ctx, tx, itemID, linkID, 1)

	res := doJSON(t, srv, http.MethodDelete, vendorPath(id, ""), nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusConflict, res.StatusCode)
	assert.Equal(t, "Data ini sedang dipakai pengguna lain. Coba lagi sebentar lagi.", problemOf(t, res).Detail)

	require.NoError(t, tx.Rollback(ctx))
	res = doJSON(t, srv, http.MethodDelete, vendorPath(id, ""), nil)
	res.Body.Close()
	assert.Equal(t, http.StatusNoContent, res.StatusCode)
}

// Failing steps answer 500.
// Begin, the two locks, the usage count and the two deletes.
func TestHandler_Delete_Faults(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	id, _, _, _ := linkedVendor(t, ctx, tx, true)

	assertDeleteFails := func(t *testing.T, srv string) {
		t.Helper()
		req, err := http.NewRequest(http.MethodDelete, srv+vendorPath(id, ""), nil)
		require.NoError(t, err)
		res, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		defer res.Body.Close()
		assertInternalProblem(t, res)
	}
	t.Run("no transaction", func(t *testing.T) {
		assertDeleteFails(t, mountedSrv(t, testutil.FakeExec{}).URL)
	})
	t.Run("begin", func(t *testing.T) {
		assertDeleteFails(t, mountedSrv(t, testutil.FailBegin{}).URL)
	})
	for step := 1; step <= 5; step++ {
		t.Run(fmt.Sprintf("statement %d", step), func(t *testing.T) {
			assertDeleteFails(t, mountedSrv(t, testutil.FailAtTx{Inner: tx, FailAt: step}).URL)
		})
	}
	var stays int
	require.NoError(t, tx.QueryRow(ctx, `SELECT COUNT(*) FROM vendors WHERE id = $1`, id).Scan(&stays))
	assert.Equal(t, 1, stays)
}
