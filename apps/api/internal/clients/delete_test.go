package clients_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// txClient inserts a transient client.
// One active contact hangs off it; the whole tree rolls back with tx.
func txClient(t *testing.T, ctx context.Context, tx pgx.Tx, active bool) (id, contactID int64, name string) {
	t.Helper()
	name = fmt.Sprintf("PT Salah Input %d", time.Now().UnixNano())
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO company_client (number, name, country_code, is_active, created_by, updated_by)
		VALUES ($1, $2, 'IDN', $3, $4, $4) RETURNING id`,
		*freeNumber(t, tx), name, active, seedUserID).Scan(&id))
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO company_contacts (company_id, name, phone, created_by, updated_by)
		VALUES ($1, 'Budi', '81234567890', $2, $2) RETURNING id`,
		id, seedUserID).Scan(&contactID))
	return id, contactID, name
}

// txQuotation inserts a sent quotation.
func txQuotation(t *testing.T, ctx context.Context, tx pgx.Tx, clientID int64, contactID *int64) int64 {
	t.Helper()
	var id int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO quotations (quotation_no, company_client_id, company_client_name, contact_id,
		                        discount_pct, total_produk, total, total_discount,
		                        status, created_by, updated_by)
		VALUES ($1, $2, 'PT Fixture', $3, 0, 10000, 10000, 0, 'sent', $4, $4)
		RETURNING id`,
		fmt.Sprintf("SQ-HAPUS-%d", time.Now().UnixNano()), clientID, contactID, seedUserID).Scan(&id))
	return id
}

// problemOf decodes a problem body.
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

// Unused clients go for good.
// Active or not, its contacts go with it and the delete is logged with
// the name, since the row is gone afterwards.
func TestHandler_Delete_Unused(t *testing.T) {
	for _, active := range []bool{true, false} {
		t.Run(fmt.Sprintf("active=%v", active), func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			srv := mountedSrv(t, tx)
			id, _, name := txClient(t, ctx, tx, active)
			logs := captureLog(t)

			res := doJSON(t, srv, http.MethodDelete, "/clients/"+itoa(id), nil)
			res.Body.Close()
			require.Equal(t, http.StatusNoContent, res.StatusCode)

			res = doJSON(t, srv, http.MethodGet, "/clients/"+itoa(id), nil)
			res.Body.Close()
			assert.Equal(t, http.StatusNotFound, res.StatusCode)
			var contacts int
			require.NoError(t, tx.QueryRow(ctx,
				`SELECT COUNT(*) FROM company_contacts WHERE company_id = $1`, id).Scan(&contacts))
			assert.Zero(t, contacts)

			var line map[string]any
			require.NoError(t, json.Unmarshal(logs.Bytes(), &line))
			assert.Equal(t, "permanent delete", line["msg"])
			assert.Equal(t, "client", line["entity"])
			assert.EqualValues(t, id, line["id"])
			assert.Equal(t, name, line["name"])
			assert.EqualValues(t, seedUserID, line["user_id"])
		})
	}
}

// A used client is refused.
// The 409 is tagged and says where the client is used; the row stays.
func TestHandler_Delete_InUse(t *testing.T) {
	cases := []struct {
		name string
		use  func(t *testing.T, ctx context.Context, tx pgx.Tx, id, contactID int64)
		want string
	}{
		{"quotation", func(t *testing.T, ctx context.Context, tx pgx.Tx, id, _ int64) {
			txQuotation(t, ctx, tx, id, nil)
		}, "Klien ini sudah dipakai di 1 quotation. Nonaktifkan saja."},
		{"accepted with PO and invoice", func(t *testing.T, ctx context.Context, tx pgx.Tx, id, _ int64) {
			qid := txQuotation(t, ctx, tx, id, nil)
			txQuotation(t, ctx, tx, id, nil)
			_, err := tx.Exec(ctx, `
				INSERT INTO quotation_items (quotation_id, line_number, item_type, requested_name,
				                             offered_item_id, vendor_product_id, qty, unit_id,
				                             selling_price, cost_price, discount_pct, created_by)
				VALUES ($1, 1, 'product', 'Test Fixture Item', 9000001, 9000001, 1, 19, 10000, 5000, 0, $2)`,
				qid, seedUserID)
			require.NoError(t, err)
			_, err = tx.Exec(ctx, `SELECT fn_change_quotation_status($1, 'accepted', $2)`, qid, seedUserID)
			require.NoError(t, err)
			_, err = tx.Exec(ctx, `
				INSERT INTO invoices (invoice_no, quotation_id, company_client_id, invoice_date,
				                      buyer_name, created_by)
				VALUES ($1, $2, $3, CURRENT_DATE, 'PT Fixture', $4)`,
				fmt.Sprintf("INV-HAPUS-%d", time.Now().UnixNano()), qid, id, seedUserID)
			require.NoError(t, err)
		}, "Klien ini sudah dipakai di 2 quotation, 1 PO dan 1 invoice. Nonaktifkan saja."},
		// A contact picked by another client's document still counts.
		{"contact on another client's quotation", func(t *testing.T, ctx context.Context, tx pgx.Tx, _, contactID int64) {
			txQuotation(t, ctx, tx, seedCompanyID, &contactID)
		}, "Klien ini sudah dipakai di 1 quotation. Nonaktifkan saja."},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			srv := mountedSrv(t, tx)
			id, contactID, _ := txClient(t, ctx, tx, true)
			tc.use(t, ctx, tx, id, contactID)

			res := doJSON(t, srv, http.MethodDelete, "/clients/"+itoa(id), nil)
			defer res.Body.Close()
			require.Equal(t, http.StatusConflict, res.StatusCode)
			p := problemOf(t, res)
			assert.Equal(t, httperr.InUseCode, p.Code)
			assert.Equal(t, tc.want, p.Detail)

			var left int
			require.NoError(t, tx.QueryRow(ctx,
				`SELECT COUNT(*) FROM company_contacts WHERE company_id = $1`, id).Scan(&left))
			assert.Equal(t, 1, left)
		})
	}
}

// Missing or malformed ids.
func TestHandler_Delete_BadTarget(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodDelete, "/clients/999999999", nil)
	res.Body.Close()
	assert.Equal(t, http.StatusNotFound, res.StatusCode)

	res = doJSON(t, srv, http.MethodDelete, "/clients/abc", nil)
	res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

// A document saving now wins.
// Its uncommitted insert holds a key lock on the client, so the delete is
// refused at once with a retryable 409 instead of waiting into a deadlock;
// once that save is gone the delete goes through.
func TestHandler_Delete_RacesASave(t *testing.T) {
	id := newClient(t)
	srv := newSrv(t)

	ctx, tx := testutil.BeginTx(t)
	txQuotation(t, ctx, tx, id, nil)

	res := doJSON(t, srv, http.MethodDelete, "/clients/"+itoa(id), nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusConflict, res.StatusCode)
	assert.Equal(t, "Data ini sedang dipakai pengguna lain. Coba lagi sebentar lagi.", problemOf(t, res).Detail)

	require.NoError(t, tx.Rollback(ctx))
	res = doJSON(t, srv, http.MethodDelete, "/clients/"+itoa(id), nil)
	res.Body.Close()
	assert.Equal(t, http.StatusNoContent, res.StatusCode)
}

// Failing steps answer 500.
// Begin, the two locks, the usage count and the two deletes.
func TestHandler_Delete_Faults(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	id, _, _ := txClient(t, ctx, tx, true)

	assertDeleteFails := func(t *testing.T, srv string) {
		t.Helper()
		req, err := http.NewRequest(http.MethodDelete, srv+"/clients/"+itoa(id), nil)
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
	require.NoError(t, tx.QueryRow(ctx, `SELECT COUNT(*) FROM company_client WHERE id = $1`, id).Scan(&stays))
	assert.Equal(t, 1, stays)
}
