package purchaseorders_test

import (
	"fmt"
	"net/http"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Notes save under the current version and read back.
func TestHandler_UpdateNotes_RoundTrip(t *testing.T) {
	ctx, tx, srv := txServer(t)
	_, poID := acceptedQuotationWithPO(t, tx)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	before, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)

	res := doJSONWithHeaders(t, srv, http.MethodPatch, fmt.Sprintf("/purchase-orders/%d/notes", poID),
		purchaseorders.UpdateNotesRequest{Notes: "Kirim sebelum kapal sandar"},
		map[string]string{"If-Match": strconv.Itoa(int(before.RowVersion))})
	defer res.Body.Close()
	require.Equal(t, http.StatusNoContent, res.StatusCode)

	after, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	require.NotNil(t, after.Notes)
	assert.Equal(t, "Kirim sebelum kapal sandar", *after.Notes)
	assert.Greater(t, after.RowVersion, before.RowVersion)
}

// Malformed and stale versions are refused before any write.
func TestHandler_IfMatchRefusals(t *testing.T) {
	tests := []struct {
		name    string
		method  string
		suffix  string
		body    any
		ifMatch string
		want    int
		detail  string
	}{
		{"notes malformed", http.MethodPatch, "/notes", purchaseorders.UpdateNotesRequest{Notes: "x"},
			"abc", http.StatusBadRequest, "invalid If-Match header"},
		{"items malformed", http.MethodPut, "/items", itemsAt("1000"),
			"abc", http.StatusBadRequest, "invalid If-Match header"},
		{"items stale", http.MethodPut, "/items", itemsAt("1000"),
			"stale", http.StatusConflict, "purchase order row_version mismatch"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx, srv := txServer(t)
			_, poID := acceptedQuotationWithPO(t, tx)
			ifMatch := tc.ifMatch
			if ifMatch == "stale" {
				po, err := purchaseorders.NewRepo(tx, testutil.Store(t)).GetByID(ctx, poID)
				require.NoError(t, err)
				ifMatch = strconv.Itoa(int(po.RowVersion) + 3)
			}
			res := doJSONWithHeaders(t, srv, tc.method, fmt.Sprintf("/purchase-orders/%d%s", poID, tc.suffix),
				tc.body, map[string]string{"If-Match": ifMatch})
			defer res.Body.Close()
			require.Equal(t, tc.want, res.StatusCode)
			p := readProblem(t, res)
			assert.Contains(t, p.Detail, tc.detail)
			assert.Empty(t, p.Code, "only a lock carries po_locked")
		})
	}
}

// A discount outside 0..100 is the database's 422.
func TestHandler_UpdateItems_DiscountOutOfRange(t *testing.T) {
	ctx, tx, srv := txServer(t)
	_, poID := acceptedQuotationWithPO(t, tx)
	po, err := purchaseorders.NewRepo(tx, testutil.Store(t)).GetByID(ctx, poID)
	require.NoError(t, err)

	req := itemsAt("1000")
	req.DiscountPct = "150"
	res := doJSONWithHeaders(t, srv, http.MethodPut, fmt.Sprintf("/purchase-orders/%d/items", poID),
		req, map[string]string{"If-Match": strconv.Itoa(int(po.RowVersion))})
	defer res.Body.Close()
	require.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
	assert.Contains(t, readProblem(t, res).Detail, "discount_pct")
}

// A saved edit answers with the next version.
func TestHandler_UpdateItems_ReturnsNewVersion(t *testing.T) {
	ctx, tx, srv := txServer(t)
	_, poID := acceptedQuotationWithPO(t, tx)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	before, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)

	res := doJSONWithHeaders(t, srv, http.MethodPut, fmt.Sprintf("/purchase-orders/%d/items", poID),
		itemsAt("125000"), map[string]string{"If-Match": strconv.Itoa(int(before.RowVersion))})
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var out struct {
		ID         int64 `json:"id"`
		RowVersion int32 `json:"rowVersion"`
	}
	readJSON(t, res, &out)
	after, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	assert.Equal(t, poID, out.ID)
	assert.Equal(t, after.RowVersion, out.RowVersion)
	assert.Equal(t, "277500.00", after.PoGrandTotal)
}

// The ON_PROGRESS gate answers for the PO it reads.
func TestHandler_ChangeStatus_OnProgressGate(t *testing.T) {
	tests := []struct {
		name   string
		from   purchaseorders.Status
		id     func(poID int64) int64
		want   int
		detail string
		field  string
	}{
		{"unknown PO", purchaseorders.StatusUploaded, func(int64) int64 { return 99999999 },
			http.StatusNotFound, "purchase order not found", ""},
		{"not from UPLOADED falls to the database", purchaseorders.StatusPending, func(id int64) int64 { return id },
			http.StatusUnprocessableEntity, "", "status"},
		{"complete data passes", purchaseorders.StatusUploaded, func(id int64) int64 { return id },
			http.StatusNoContent, "", ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx, srv := txServer(t)
			_, poID := poAt(t, tx, tc.from)
			res := doJSON(t, srv, http.MethodPatch, fmt.Sprintf("/purchase-orders/%d/status", tc.id(poID)),
				purchaseorders.ChangeStatusRequest{Status: purchaseorders.StatusOnProgress})
			defer res.Body.Close()
			require.Equal(t, tc.want, res.StatusCode)
			if tc.want == http.StatusNoContent {
				po, err := purchaseorders.NewRepo(tx, testutil.Store(t)).GetByID(ctx, poID)
				require.NoError(t, err)
				assert.Equal(t, purchaseorders.StatusOnProgress, po.Status)
				return
			}
			p := readProblem(t, res)
			if tc.detail != "" {
				assert.Equal(t, tc.detail, p.Detail)
			}
			if tc.field != "" {
				assert.NotEmpty(t, p.Fields[tc.field])
			}
		})
	}
}

// History and file removal validate the id and the PO.
func TestHandler_HistoryAndRemoveFile_Refusals(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		want   int
		detail string
	}{
		{"history bad id", http.MethodGet, "/purchase-orders/abc/history", http.StatusBadRequest, "invalid id"},
		{"history unknown", http.MethodGet, "/purchase-orders/99999999/history",
			http.StatusNotFound, "purchase order not found"},
		{"remove bad id", http.MethodDelete, "/purchase-orders/abc/file", http.StatusBadRequest, "invalid id"},
		{"remove unknown", http.MethodDelete, "/purchase-orders/99999999/file",
			http.StatusNotFound, "purchase order not found"},
	}
	_, _, srv := txServer(t)
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			res := doJSON(t, srv, tc.method, tc.path, nil)
			defer res.Body.Close()
			require.Equal(t, tc.want, res.StatusCode)
			assert.Equal(t, tc.detail, readProblem(t, res).Detail)
		})
	}
}

// A database failure on any route is a generic 500.
func TestHandler_DatabaseFaults(t *testing.T) {
	file := purchaseorders.UpdateFileRequest{FileName: "po.pdf", FileSize: 1, ObjectKey: "po/1/1-po.pdf"}
	tests := []struct {
		name   string
		method string
		path   string
		body   any
	}{
		{"list items", http.MethodGet, "/purchase-orders/1/items", nil},
		{"export", http.MethodGet, "/purchase-orders/export.xlsx", nil},
		{"history", http.MethodGet, "/purchase-orders/1/history", nil},
		{"remove file", http.MethodDelete, "/purchase-orders/1/file", nil},
		{"details", http.MethodPatch, "/purchase-orders/1/details",
			purchaseorders.UpdateDetailsRequest{PoNumber: "PO/1", PoDate: "2026-01-15"}},
		{"items", http.MethodPut, "/purchase-orders/1/items", itemsAt("1000")},
		{"start work", http.MethodPatch, "/purchase-orders/1/status",
			purchaseorders.ChangeStatusRequest{Status: purchaseorders.StatusOnProgress}},
		{"attach", http.MethodPatch, "/purchase-orders/1/file", file},
	}
	srv := execServer(t, testutil.FakeExec{}, "")
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			res := doJSONWithHeaders(t, srv, tc.method, tc.path, tc.body, map[string]string{"If-Match": "0"})
			defer res.Body.Close()
			require.Equal(t, http.StatusInternalServerError, res.StatusCode)
			assert.Equal(t, "internal server error", readProblem(t, res).Detail)
		})
	}
}

// A failure after the PO was read is still a generic 500.
func TestHandler_SecondQueryFaults(t *testing.T) {
	tests := []struct {
		name   string
		from   purchaseorders.Status
		method string
		suffix string
		body   func(poID int64) any
	}{
		{"completeness check", purchaseorders.StatusUploaded, http.MethodPatch, "/status",
			func(int64) any { return purchaseorders.ChangeStatusRequest{Status: purchaseorders.StatusOnProgress} }},
		{"attach after the owner check", purchaseorders.StatusPending, http.MethodPatch, "/file",
			func(poID int64) any { return ownedPOFile(poID) }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, tx := testutil.BeginTx(t)
			_, poID := poAt(t, tx, tc.from)
			srv := execServer(t, &testutil.CountingExec{Inner: tx, FailAfter: 1}, "")
			res := doJSON(t, srv, tc.method, fmt.Sprintf("/purchase-orders/%d%s", poID, tc.suffix), tc.body(poID))
			defer res.Body.Close()
			require.Equal(t, http.StatusInternalServerError, res.StatusCode)
			assert.Equal(t, "internal server error", readProblem(t, res).Detail)
		})
	}
}
