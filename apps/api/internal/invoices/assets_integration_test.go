package invoices_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/storage"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// assetServer mounts routes with storage.
// A zero storage client presigns offline, so no MinIO is needed.
func assetServer(t *testing.T, exec db.Executor) *httptest.Server {
	t.Helper()
	r := chi.NewRouter()
	r.Use(injectUser(seedUserID))
	r.Mount("/invoices", invoices.Routes(deps.Deps{
		Pool: exec, Queries: testutil.Store(t), Storage: &storage.Client{},
	}))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

// call sends and decodes JSON.
func call(t *testing.T, srv *httptest.Server, method, path string, body any) (int, map[string]any) {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		require.NoError(t, err)
		rdr = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, srv.URL+path, rdr)
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	require.NoError(t, err)
	out := map[string]any{}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &out)
	}
	return res.StatusCode, out
}

// Attachment upload, save, download.
func TestAttachmentRoutes_Roundtrip(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)
	srv := assetServer(t, tx)
	base := "/invoices/" + strconv.FormatInt(invID, 10)
	folder := storage.OwnerFolder("invoices", invID, "")

	code, body := call(t, srv, http.MethodGet, base+"/attachment/download-url", nil)
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "no attachment", body["detail"])

	code, body = call(t, srv, http.MethodGet, base+"/attachment/upload-url?fileName=faktur.pdf", nil)
	require.Equal(t, http.StatusOK, code, body)
	key, _ := body["objectKey"].(string)
	assert.True(t, strings.HasPrefix(key, folder), "key %q is outside %q", key, folder)
	assert.True(t, strings.HasSuffix(key, "-faktur.pdf"), key)
	assert.NotEmpty(t, body["uploadUrl"])

	code, body = call(t, srv, http.MethodPatch, base+"/attachment", map[string]string{"objectKey": key})
	require.Equal(t, http.StatusNoContent, code, body)
	inv, err := invoices.NewRepo(tx, testutil.Store(t)).GetByID(ctx, invID)
	require.NoError(t, err)
	require.NotNil(t, inv.AttachmentObjectKey)
	assert.Equal(t, key, *inv.AttachmentObjectKey)

	code, body = call(t, srv, http.MethodGet, base+"/attachment/download-url", nil)
	require.Equal(t, http.StatusOK, code, body)
	assert.Contains(t, body["downloadUrl"], url.QueryEscape(key))
}

// Attachment routes refuse strangers.
func TestAttachmentRoutes_Refusals(t *testing.T) {
	_, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)
	srv := assetServer(t, tx)
	base := "/invoices/" + strconv.FormatInt(invID, 10)
	other := storage.OwnerFolder("invoices", invID+1, "") + "1700000000-faktur.pdf"
	proof := storage.OwnerFolder("invoices", invID, "payment") + "1700000000-bukti.pdf"

	cases := []struct {
		name, method, path string
		body               any
		want               int
		detail             string
	}{
		{name: "upload for a missing invoice", method: http.MethodGet,
			path: "/invoices/99999999/attachment/upload-url?fileName=a.pdf", want: http.StatusNotFound, detail: "invoice not found"},
		{name: "download for a missing invoice", method: http.MethodGet,
			path: "/invoices/99999999/attachment/download-url", want: http.StatusNotFound, detail: "invoice not found"},
		{name: "save for a missing invoice", method: http.MethodPatch,
			path: "/invoices/99999999/attachment", body: map[string]string{"objectKey": other}, want: http.StatusNotFound, detail: "invoice not found"},
		{name: "another invoice's key", method: http.MethodPatch,
			path: base + "/attachment", body: map[string]string{"objectKey": other}, want: http.StatusUnprocessableEntity},
		{name: "a payment proof key is not the attachment", method: http.MethodPatch,
			path: base + "/attachment", body: map[string]string{"objectKey": proof}, want: http.StatusUnprocessableEntity},
		{name: "no payment proof yet", method: http.MethodGet,
			path: base + "/payment-proof/download-url", want: http.StatusNotFound, detail: "no payment proof"},
		{name: "proof for a missing invoice", method: http.MethodGet,
			path: "/invoices/99999999/payment-proof/download-url", want: http.StatusNotFound, detail: "invoice not found"},
		{name: "the proof key is saved only by paying", method: http.MethodPatch,
			path: base + "/payment-proof", body: map[string]string{"objectKey": proof}, want: http.StatusNotFound},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			code, body := call(t, srv, tc.method, tc.path, tc.body)
			assert.Equal(t, tc.want, code, body)
			if tc.detail != "" {
				assert.Equal(t, tc.detail, body["detail"])
			}
		})
	}
}

// Paid invoice serves its proof.
func TestPaymentProofRoutes_ServePaidProof(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)
	srv := assetServer(t, tx)
	base := "/invoices/" + strconv.FormatInt(invID, 10)

	code, body := call(t, srv, http.MethodGet, base+"/payment-proof/upload-url?fileName=bukti.pdf", nil)
	require.Equal(t, http.StatusOK, code, body)
	key, _ := body["objectKey"].(string)
	assert.True(t, strings.HasPrefix(key, storage.OwnerFolder("invoices", invID, "payment")), key)

	repo := invoices.NewRepo(tx, testutil.Store(t))
	require.NoError(t, repo.ChangeStatus(ctx, invID, move(invoices.StatusSent), seedUserID))
	require.NoError(t, repo.ChangeStatus(ctx, invID,
		invoices.ChangeStatusRequest{Status: invoices.StatusPaid, PaymentProofKey: &key}, seedUserID))

	code, body = call(t, srv, http.MethodGet, base+"/payment-proof/download-url", nil)
	require.Equal(t, http.StatusOK, code, body)
	assert.Contains(t, body["downloadUrl"], url.QueryEscape(key))
}

// Asset DB failures are 500.
func TestAssetRoutes_DatabaseFailure(t *testing.T) {
	srv := assetServer(t, testutil.FakeExec{})
	for _, path := range []string{
		"/invoices/1/attachment/upload-url?fileName=a.pdf",
		"/invoices/1/attachment/download-url",
		"/invoices/1/payment-proof/download-url",
	} {
		t.Run(path, func(t *testing.T) {
			code, body := call(t, srv, http.MethodGet, path, nil)
			assert.Equal(t, http.StatusInternalServerError, code, body)
		})
	}
}

// UpdateAttachment reports missing rows.
func TestRepo_UpdateAttachment(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	store := testutil.Store(t)

	err := invoices.NewRepo(tx, store).UpdateAttachment(ctx, 99999999, "invoices/99999999/a.pdf", seedUserID)
	assert.ErrorIs(t, err, invoices.ErrNotFound)

	err = invoices.NewRepo(testutil.FakeExec{}, store).UpdateAttachment(context.Background(), 1, "k", seedUserID)
	assert.ErrorIs(t, err, testutil.ErrFake)
}
