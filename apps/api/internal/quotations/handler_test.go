package quotations_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

func resetServer(t *testing.T) (*httptest.Server, context.Context) {
	t.Helper()
	pool := testutil.Pool(t)
	ctx := context.Background()
	require.NoError(t, testutil.ResetQuotationDomain(ctx, pool))
	srv := testutil.QuotationServer(t, seedUserID)
	t.Cleanup(func() { _ = testutil.ResetQuotationDomain(ctx, pool) })
	return srv, ctx
}

func doJSON(t *testing.T, srv *httptest.Server, method, path string, body any) *http.Response {
	t.Helper()
	return doJSONWithHeaders(t, srv, method, path, body, nil)
}

func doJSONWithHeaders(
	t *testing.T,
	srv *httptest.Server,
	method, path string,
	body any,
	headers map[string]string,
) *http.Response {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		require.NoError(t, err)
		rdr = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, srv.URL+path, rdr)
	require.NoError(t, err)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	return res
}

func getRowVersion(t *testing.T, srv *httptest.Server, id int64) int32 {
	t.Helper()
	res := doJSON(t, srv, http.MethodGet, "/quotations/"+strconv.FormatInt(id, 10), nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var d quotations.QuotationDetail
	require.NoError(t, json.NewDecoder(res.Body).Decode(&d))
	return d.RowVersion
}

func decodeBody(t *testing.T, res *http.Response, v any) {
	t.Helper()
	defer res.Body.Close()
	require.NoError(t, json.NewDecoder(res.Body).Decode(v))
}

func TestHandler_Create_HappyPath(t *testing.T) {
	srv, _ := resetServer(t)
	res := doJSON(t, srv, http.MethodPost, "/quotations/", sampleCreate())
	defer res.Body.Close()
	require.Equal(t, http.StatusCreated, res.StatusCode)
	var got map[string]int64
	require.NoError(t, json.NewDecoder(res.Body).Decode(&got))
	assert.Greater(t, got["id"], int64(0))
}

func TestHandler_Create_InvalidJSON(t *testing.T) {
	srv, _ := resetServer(t)
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/quotations/", strings.NewReader("not-json"))
	req.Header.Set("Content-Type", "application/json")
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Create_MissingClient(t *testing.T) {
	srv, _ := resetServer(t)
	req := sampleCreate()
	req.CompanyClientID = 0
	res := doJSON(t, srv, http.MethodPost, "/quotations/", req)
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func TestHandler_Create_MissingItems(t *testing.T) {
	srv, _ := resetServer(t)
	req := sampleCreate()
	req.Items = nil
	res := doJSON(t, srv, http.MethodPost, "/quotations/", req)
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func TestHandler_Create_DBValidationError(t *testing.T) {
	srv, _ := resetServer(t)
	req := sampleCreate()
	req.DiscountPct = "300"
	res := doJSON(t, srv, http.MethodPost, "/quotations/", req)
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func TestHandler_GetAndList(t *testing.T) {
	srv, _ := resetServer(t)
	id := mustCreate(t, srv)

	res := doJSON(t, srv, http.MethodGet, "/quotations/"+strconv.FormatInt(id, 10), nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var d quotations.QuotationDetail
	decodeBody(t, res, &d)
	assert.Equal(t, id, d.ID)

	listRes := doJSON(t, srv, http.MethodGet, "/quotations/", nil)
	defer listRes.Body.Close()
	require.Equal(t, http.StatusOK, listRes.StatusCode)
	var rows []quotations.ListRow
	decodeBody(t, listRes, &rows)
	assert.NotEmpty(t, rows)
}

func TestHandler_Get_BadID(t *testing.T) {
	srv, _ := resetServer(t)
	res := doJSON(t, srv, http.MethodGet, "/quotations/abc", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Get_NotFound(t *testing.T) {
	srv, _ := resetServer(t)
	res := doJSON(t, srv, http.MethodGet, "/quotations/999999", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusNotFound, res.StatusCode)
}

func TestHandler_List_WithFilters(t *testing.T) {
	srv, _ := resetServer(t)
	mustCreate(t, srv)

	res := doJSON(t, srv, http.MethodGet, "/quotations/?q=IMC&status=draft&limit=5&offset=0&sortBy=created_at&sortDir=desc", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)

	res2 := doJSON(t, srv, http.MethodGet, "/quotations/?dateFrom=1900-01-01&dateTo=2099-12-31&minTotal=0&maxTotal=99999999&limit=abc&offset=-1", nil)
	defer res2.Body.Close()
	assert.Equal(t, http.StatusOK, res2.StatusCode)
}

func TestHandler_Stats(t *testing.T) {
	srv, _ := resetServer(t)
	mustCreate(t, srv)
	res := doJSON(t, srv, http.MethodGet, "/quotations/stats", nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var stats []quotations.StatusCount
	decodeBody(t, res, &stats)
	assert.NotEmpty(t, stats)
}

func TestHandler_Update(t *testing.T) {
	srv, _ := resetServer(t)
	id := mustCreate(t, srv)
	rv := getRowVersion(t, srv, id)
	upd := quotations.UpdateRequest{
		DiscountPct: "0",
		Items: []quotations.CreateItem{{
			RequestedName: "REVISED",
			Qty:           "1",
			UnitID:        seedUnitID,
			SellingPrice:  "1000",
		}},
	}
	res := doJSONWithHeaders(t, srv, http.MethodPut,
		"/quotations/"+strconv.FormatInt(id, 10), upd,
		map[string]string{"If-Match": strconv.FormatInt(int64(rv), 10)})
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
	var got struct {
		ID         int64 `json:"id"`
		RowVersion int32 `json:"rowVersion"`
	}
	require.NoError(t, json.NewDecoder(res.Body).Decode(&got))
	assert.Equal(t, id, got.ID)
	assert.Greater(t, got.RowVersion, rv)
}

func TestHandler_Update_MissingIfMatch(t *testing.T) {
	srv, _ := resetServer(t)
	id := mustCreate(t, srv)
	res := doJSON(t, srv, http.MethodPut,
		"/quotations/"+strconv.FormatInt(id, 10),
		quotations.UpdateRequest{DiscountPct: "0", Items: []quotations.CreateItem{{
			RequestedName: "X", Qty: "1", UnitID: seedUnitID, SellingPrice: "1",
		}}})
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Update_VersionMismatch(t *testing.T) {
	srv, _ := resetServer(t)
	id := mustCreate(t, srv)
	upd := quotations.UpdateRequest{
		DiscountPct: "0",
		Items: []quotations.CreateItem{{
			RequestedName: "X", Qty: "1", UnitID: seedUnitID, SellingPrice: "1",
		}},
	}
	res := doJSONWithHeaders(t, srv, http.MethodPut,
		"/quotations/"+strconv.FormatInt(id, 10), upd,
		map[string]string{"If-Match": "999"})
	defer res.Body.Close()
	assert.Equal(t, http.StatusConflict, res.StatusCode)
}

func TestHandler_Update_BadID(t *testing.T) {
	srv, _ := resetServer(t)
	res := doJSON(t, srv, http.MethodPut, "/quotations/foo", quotations.UpdateRequest{})
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Update_BadJSON(t *testing.T) {
	srv, _ := resetServer(t)
	id := mustCreate(t, srv)
	rv := getRowVersion(t, srv, id)
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/quotations/"+strconv.FormatInt(id, 10), strings.NewReader("?"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("If-Match", strconv.FormatInt(int64(rv), 10))
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Update_EmptyItems(t *testing.T) {
	srv, _ := resetServer(t)
	id := mustCreate(t, srv)
	rv := getRowVersion(t, srv, id)
	res := doJSONWithHeaders(t, srv, http.MethodPut,
		"/quotations/"+strconv.FormatInt(id, 10),
		quotations.UpdateRequest{DiscountPct: "0"},
		map[string]string{"If-Match": strconv.FormatInt(int64(rv), 10)})
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func TestHandler_Update_DBRejects(t *testing.T) {
	srv, _ := resetServer(t)
	id := mustCreate(t, srv)
	send := quotations.ChangeStatusRequest{Status: "sent"}
	sres := doJSON(t, srv, http.MethodPatch, "/quotations/"+strconv.FormatInt(id, 10)+"/status", send)
	sres.Body.Close()
	rv := getRowVersion(t, srv, id)

	upd := quotations.UpdateRequest{DiscountPct: "5", Items: []quotations.CreateItem{{
		RequestedName: "NO", Qty: "1", UnitID: seedUnitID, SellingPrice: "1",
	}}}
	res := doJSONWithHeaders(t, srv, http.MethodPut,
		"/quotations/"+strconv.FormatInt(id, 10), upd,
		map[string]string{"If-Match": strconv.FormatInt(int64(rv), 10)})
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func TestHandler_ChangeStatus(t *testing.T) {
	srv, _ := resetServer(t)
	id := mustCreate(t, srv)

	res := doJSON(t, srv, http.MethodPatch, "/quotations/"+strconv.FormatInt(id, 10)+"/status", quotations.ChangeStatusRequest{Status: "sent"})
	defer res.Body.Close()
	assert.Equal(t, http.StatusNoContent, res.StatusCode)
}

// Send-time guard: a product line with no selling price blocks finalizing.
func TestHandler_ChangeStatus_RejectsUnpricedOnSend(t *testing.T) {
	srv, _ := resetServer(t)
	req := sampleCreate()
	req.Items = []quotations.CreateItem{{
		RequestedItemID: int64Ptr(seedItemID),
		RequestedName:   "Unpriced Imported Item",
		Qty:             "1",
		UnitID:          seedUnitID,
		SellingPrice:    "0",
	}}
	cres := doJSON(t, srv, http.MethodPost, "/quotations/", req)
	require.Equal(t, http.StatusCreated, cres.StatusCode)
	var got map[string]int64
	require.NoError(t, json.NewDecoder(cres.Body).Decode(&got))
	cres.Body.Close()
	id := got["id"]

	sres := doJSON(t, srv, http.MethodPatch,
		"/quotations/"+strconv.FormatInt(id, 10)+"/status",
		quotations.ChangeStatusRequest{Status: "sent"})
	defer sres.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, sres.StatusCode)
}

func TestHandler_ChangeStatus_BadID(t *testing.T) {
	srv, _ := resetServer(t)
	res := doJSON(t, srv, http.MethodPatch, "/quotations/foo/status", quotations.ChangeStatusRequest{Status: "sent"})
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_ChangeStatus_BadJSON(t *testing.T) {
	srv, _ := resetServer(t)
	id := mustCreate(t, srv)
	req, _ := http.NewRequest(http.MethodPatch, srv.URL+"/quotations/"+strconv.FormatInt(id, 10)+"/status", strings.NewReader("?"))
	req.Header.Set("Content-Type", "application/json")
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_ChangeStatus_EmptyStatus(t *testing.T) {
	srv, _ := resetServer(t)
	id := mustCreate(t, srv)
	res := doJSON(t, srv, http.MethodPatch, "/quotations/"+strconv.FormatInt(id, 10)+"/status", quotations.ChangeStatusRequest{})
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func TestHandler_ChangeStatus_InvalidTransition(t *testing.T) {
	srv, _ := resetServer(t)
	id := mustCreate(t, srv)
	res := doJSON(t, srv, http.MethodPatch, "/quotations/"+strconv.FormatInt(id, 10)+"/status", quotations.ChangeStatusRequest{Status: "accepted"})
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func TestHandler_Send(t *testing.T) {
	srv, _ := resetServer(t)
	id := mustCreate(t, srv)
	res := doJSON(t, srv, http.MethodPost, "/quotations/"+strconv.FormatInt(id, 10)+"/send", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusNoContent, res.StatusCode)
}

func TestHandler_Send_BadID(t *testing.T) {
	srv, _ := resetServer(t)
	res := doJSON(t, srv, http.MethodPost, "/quotations/foo/send", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Send_FailsWhenAlreadyAccepted(t *testing.T) {
	srv, _ := resetServer(t)
	id := mustCreate(t, srv)
	doJSON(t, srv, http.MethodPost, "/quotations/"+strconv.FormatInt(id, 10)+"/send", nil).Body.Close()
	doJSON(t, srv, http.MethodPatch, "/quotations/"+strconv.FormatInt(id, 10)+"/status", quotations.ChangeStatusRequest{Status: "accepted"}).Body.Close()

	res := doJSON(t, srv, http.MethodPost, "/quotations/"+strconv.FormatInt(id, 10)+"/send", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func mustCreate(t *testing.T, srv *httptest.Server) int64 {
	t.Helper()
	res := doJSON(t, srv, http.MethodPost, "/quotations/", sampleCreate())
	defer res.Body.Close()
	require.Equal(t, http.StatusCreated, res.StatusCode)
	var got map[string]int64
	require.NoError(t, json.NewDecoder(res.Body).Decode(&got))
	return got["id"]
}
