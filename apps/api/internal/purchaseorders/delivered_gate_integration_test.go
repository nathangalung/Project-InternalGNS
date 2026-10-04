package purchaseorders_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// completePOInProgress builds a gate-clean PO.
// It is ON_PROGRESS and Completeness reports nothing.
func completePOInProgress(t *testing.T, tx pgx.Tx) int64 {
	t.Helper()
	ctx := context.Background()
	clientID, _ := probeClient(t, tx, "PT Lengkap Dulu")
	_, err := tx.Exec(ctx, `UPDATE company_client
		SET npwp = '0612345678901000', address = 'Jl. Pelabuhan No. 1, Jakarta Utara' WHERE id = $1`, clientID)
	require.NoError(t, err)
	contactID := insertContact(t, tx, clientID, "Bp. Lengkap", strPtr("lengkap@gns.test"))
	_, poID := createQuotation(t, tx, quotations.CreateRequest{
		ValidityDays:    testutil.Validity(),
		CompanyClientID: clientID, ContactID: &contactID, DiscountPct: "0",
		Items: []quotations.CreateItem{quoteLine(strPtr("Kapal Uji"))},
	})
	reachStatus(t, tx, poID, purchaseorders.StatusOnProgress)
	issues, err := purchaseorders.NewRepo(tx, testutil.Store(t)).Completeness(ctx, poID)
	require.NoError(t, err)
	require.Empty(t, issues, "the PO starts complete")
	return poID
}

// deliver asks for Dikirim.
func deliver(t *testing.T, srv *httptest.Server, poID int64) *http.Response {
	t.Helper()
	return doJSON(t, srv, http.MethodPatch, fmt.Sprintf("/purchase-orders/%d/status", poID),
		purchaseorders.ChangeStatusRequest{Status: purchaseorders.StatusDelivered})
}

// Delivery runs the gate again.
// Edits in ON_PROGRESS can clear the shipping address, and finance can blank
// the client's NPWP, after the promotion passed; the invoice and delivery
// note would then go out without them.
func TestHandler_DeliveredGate_ReopenedGaps(t *testing.T) {
	cases := []struct {
		name  string
		spoil func(t *testing.T, tx pgx.Tx, srv *httptest.Server, poID int64)
		code  purchaseorders.GapCode
	}{
		{"shipping address cleared", func(t *testing.T, tx pgx.Tx, srv *httptest.Server, poID int64) {
			po, err := purchaseorders.NewRepo(tx, testutil.Store(t)).GetByID(context.Background(), poID)
			require.NoError(t, err)
			res := doJSONWithHeaders(t, srv, http.MethodPut, fmt.Sprintf("/purchase-orders/%d/items", poID),
				itemsWith(purchaseorders.UpdateItemsLine{}),
				map[string]string{"If-Match": strconv.Itoa(int(po.RowVersion))})
			res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
		}, purchaseorders.GapShippingAddress},
		{"client NPWP blanked", func(t *testing.T, tx pgx.Tx, _ *httptest.Server, poID int64) {
			_, err := tx.Exec(context.Background(), `UPDATE company_client SET npwp = NULL
				WHERE id = (SELECT company_client_id FROM purchase_orders WHERE id = $1)`, poID)
			require.NoError(t, err)
		}, purchaseorders.GapClientNpwp},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ctx, tx, srv := txServer(t)
			poID := completePOInProgress(t, tx)
			c.spoil(t, tx, srv, poID)

			res := deliver(t, srv, poID)
			defer res.Body.Close()
			require.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
			var p purchaseorders.IncompleteProblem
			readJSON(t, res, &p)
			assert.Equal(t, purchaseorders.IncompleteCode, p.Code)
			require.Len(t, p.Issues, 1)
			assert.Equal(t, []purchaseorders.GapCode{c.code}, gapCodes(p.Issues[0]))

			po, err := purchaseorders.NewRepo(tx, testutil.Store(t)).GetByID(ctx, poID)
			require.NoError(t, err)
			assert.Equal(t, purchaseorders.StatusOnProgress, po.Status, "no invoice is issued")
		})
	}

	t.Run("a complete PO delivers", func(t *testing.T) {
		_, tx, srv := txServer(t)
		poID := completePOInProgress(t, tx)
		res := deliver(t, srv, poID)
		res.Body.Close()
		assert.Equal(t, http.StatusNoContent, res.StatusCode)
	})
}
