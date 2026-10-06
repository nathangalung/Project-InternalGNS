package purchaseorders_test

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// PATCH /details refusals and success.
func TestHandler_UpdateDetails(t *testing.T) {
	fiftyRunes := strings.Repeat("Ü", 50)
	tests := []struct {
		name      string
		id        string // "" means the fresh PO
		raw       string // overrides the JSON body when set
		poNumber  string
		poDate    string
		ifMatch   string // "stale" sends an old row_version
		want      int
		wantField string
		wantMsg   string
	}{
		{name: "bad id", id: "abc", poNumber: "PO/1", poDate: "2026-01-15", want: http.StatusBadRequest},
		{name: "malformed If-Match", poNumber: "PO/1", poDate: "2026-01-15", ifMatch: "abc", want: http.StatusBadRequest},
		{name: "bad json", raw: "{", want: http.StatusBadRequest},
		{name: "blank number clears it before work", poNumber: "  ", poDate: "2026-01-15", want: http.StatusNoContent},
		{name: "impossible date", poNumber: "PO/1", poDate: "2026-13-45",
			want: http.StatusUnprocessableEntity, wantField: "poDate", wantMsg: "Tanggal PO tidak valid. Pilih tanggal dari kalender."},
		{name: "date with time", poNumber: "PO/1", poDate: "2026-01-15T00:00:00Z",
			want: http.StatusUnprocessableEntity, wantField: "poDate", wantMsg: "Tanggal PO tidak valid. Pilih tanggal dari kalender."},
		{name: "unknown PO", id: "99999999", poNumber: "PO/1", poDate: "2026-01-15", want: http.StatusNotFound},
		{name: "stale If-Match", poNumber: "PO/1", poDate: "2026-01-15", ifMatch: "stale", want: http.StatusConflict},
		{name: "fifty multibyte characters fit", poNumber: fiftyRunes, poDate: "2026-01-15", want: http.StatusNoContent},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx, srv := txServer(t)
			_, poID := acceptedQuotationWithPO(t, tx)
			po, err := purchaseorders.NewRepo(tx, testutil.Store(t)).GetByID(ctx, poID)
			require.NoError(t, err)

			id := tc.id
			if id == "" {
				id = strconv.FormatInt(poID, 10)
			}
			headers := map[string]string{"Content-Type": "application/json"}
			switch tc.ifMatch {
			case "":
			case "stale":
				headers["If-Match"] = strconv.Itoa(int(po.RowVersion) + 7)
			default:
				headers["If-Match"] = tc.ifMatch
			}
			body := tc.raw
			if body == "" {
				body = fmt.Sprintf(`{"poNumber":%q,"poDate":%q}`, tc.poNumber, tc.poDate)
			}
			res := rawRequest(t, srv, http.MethodPatch, "/purchase-orders/"+id+"/details", body, headers)
			defer res.Body.Close()
			require.Equal(t, tc.want, res.StatusCode)
			if tc.want == http.StatusNoContent {
				return
			}
			p := readProblem(t, res)
			if tc.wantField != "" {
				assert.Contains(t, p.Fields[tc.wantField], tc.wantMsg)
			}
			if tc.want == http.StatusConflict {
				// A version mismatch is retried after a refetch; a lock is not.
				assert.Equal(t, httperr.VersionConflictCode, p.Code)
				assert.Equal(t, httperr.VersionConflict().Detail, p.Detail)
			}
		})
	}
}

// Saved details read back trimmed.
func TestHandler_UpdateDetails_Persists(t *testing.T) {
	ctx, tx, srv := txServer(t)
	_, poID := acceptedQuotationWithPO(t, tx)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	before, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)

	res := doJSONWithHeaders(t, srv, http.MethodPatch, fmt.Sprintf("/purchase-orders/%d/details", poID),
		purchaseorders.UpdateDetailsRequest{PoNumber: "  PO/KLIEN/77  ", PoDate: " 2026-02-03 "},
		map[string]string{"If-Match": strconv.Itoa(int(before.RowVersion))})
	defer res.Body.Close()
	require.Equal(t, http.StatusNoContent, res.StatusCode)

	after, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	require.NotNil(t, after.PoNumber)
	assert.Equal(t, "PO/KLIEN/77", *after.PoNumber)
	assert.Equal(t, "2026-02-03", after.PoDate.Format(time.DateOnly))
	assert.Greater(t, after.RowVersion, before.RowVersion)
}

// Accepting leaves the number empty.
// A PO's number is the client's own, entered later.
func TestRepo_AcceptedPOHasNoNumber(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID := acceptedQuotationWithBarePO(t, tx)
	po, err := purchaseorders.NewRepo(tx, testutil.Store(t)).GetByID(ctx, poID)
	require.NoError(t, err)
	assert.Nil(t, po.PoNumber)
}

// Blank stores none, trimmed otherwise.
// Clearing is refused once work has started.
func TestRepo_UpdateDetails_NumberRule(t *testing.T) {
	tests := []struct {
		name    string
		status  purchaseorders.Status
		number  string
		want    *string
		wantErr bool
	}{
		{"pending trims", purchaseorders.StatusPending, "  PO/K/1  ", strPtr("PO/K/1"), false},
		{"pending clears", purchaseorders.StatusPending, "   ", nil, false},
		{"uploaded clears", purchaseorders.StatusUploaded, "", nil, false},
		{"on progress keeps a number", purchaseorders.StatusOnProgress, "PO/K/2", strPtr("PO/K/2"), false},
		{"on progress refuses clearing", purchaseorders.StatusOnProgress, "  ", nil, true},
		{"delivered refuses clearing", purchaseorders.StatusDelivered, "", nil, true},
		{"cancelled clears", purchaseorders.StatusCancelled, "", nil, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			_, poID := poAt(t, tx, tc.status)
			repo := purchaseorders.NewRepo(tx, testutil.Store(t))
			before, err := repo.GetByID(ctx, poID)
			require.NoError(t, err)

			// A savepoint keeps the refused write from aborting the test tx.
			sp, err := tx.Begin(ctx)
			require.NoError(t, err)
			err = purchaseorders.NewRepo(sp, testutil.Store(t)).
				UpdateDetails(ctx, poID, tc.number, poDateFixture(), seedUserID, nil)
			if err != nil {
				require.NoError(t, sp.Rollback(ctx))
			} else {
				require.NoError(t, sp.Commit(ctx))
			}
			after, rerr := repo.GetByID(ctx, poID)
			require.NoError(t, rerr)
			if tc.wantErr {
				require.ErrorIs(t, err, purchaseorders.ErrPoNumberRequired)
				assert.EqualError(t, err,
					"No. PO klien wajib diisi untuk PO yang sudah Dalam Progres atau Dikirim.")
				assert.Equal(t, before.PoNumber, after.PoNumber, "the number stays")
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, after.PoNumber)
		})
	}
}

// Clearing in work refused.
func TestHandler_UpdateDetails_ClearInWork(t *testing.T) {
	_, tx, srv := txServer(t)
	_, poID := poAt(t, tx, purchaseorders.StatusOnProgress)

	res := doJSON(t, srv, http.MethodPatch, fmt.Sprintf("/purchase-orders/%d/details", poID),
		purchaseorders.UpdateDetailsRequest{PoNumber: " ", PoDate: "2026-01-15"})
	defer res.Body.Close()
	require.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
	assert.Equal(t, "No. PO klien wajib diisi untuk PO yang sudah Dalam Progres atau Dikirim.",
		readProblem(t, res).Fields["poNumber"])
}

// Numberless POs share a client.
// The per-client unique index leaves NULLs distinct.
func TestRepo_NumberlessPOsOfOneClient(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, first := acceptedQuotationWithBarePO(t, tx)
	_, second := acceptedQuotationWithBarePO(t, tx)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	for _, id := range []int64{first, second} {
		po, err := repo.GetByID(ctx, id)
		require.NoError(t, err)
		assert.Nil(t, po.PoNumber)
		assert.Equal(t, seedCompanyID, po.CompanyClientID)
	}
}

// Blank numbers never stored.
func TestPurchaseOrders_BlankNumberRefused(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID := acceptedQuotationWithBarePO(t, tx)
	_, err := tx.Exec(ctx, `UPDATE purchase_orders SET po_number = '  ' WHERE id = $1`, poID)
	require.ErrorContains(t, err, "purchase_orders_po_number_not_blank")
}

// Duplicates are field errors.
// Another PO of the same client already holds the number.
func TestHandler_UpdateDetails_DuplicateForClient(t *testing.T) {
	ctx, tx, srv := txServer(t)
	_, first := acceptedQuotationWithPO(t, tx)
	_, second := acceptedQuotationWithPO(t, tx)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	require.NoError(t, repo.UpdateDetails(ctx, first, "PO/DUP/1", poDateFixture(), seedUserID, nil))

	res := doJSON(t, srv, http.MethodPatch, fmt.Sprintf("/purchase-orders/%d/details", second),
		purchaseorders.UpdateDetailsRequest{PoNumber: "PO/DUP/1", PoDate: "2026-01-15"})
	defer res.Body.Close()
	require.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
	assert.Equal(t, "sudah dipakai PO lain untuk klien ini", readProblem(t, res).Fields["poNumber"])
}

// rawRequest sends body verbatim.
func rawRequest(
	t *testing.T, srv *httptest.Server, method, path, body string, headers map[string]string,
) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
	require.NoError(t, err)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	return res
}
