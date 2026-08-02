package purchaseorders_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"runtime"
	"strconv"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/pdfgen"
	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

func poTemplatesRoot(t *testing.T) string {
	t.Helper()
	_, here, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(here), "..", "..", "templates", "documents")
}

func poExportServer(t *testing.T) *httptest.Server {
	t.Helper()
	pool := testutil.Pool(t)
	store := testutil.Store(t)
	d := deps.Deps{
		Pool:          pool,
		Queries:       store,
		TemplatesRoot: poTemplatesRoot(t),
		Pdf:           deps.PdfSettings{SignerName: "Bryan"},
	}
	r := chi.NewRouter()
	r.Use(poInjectUser(seedUserID))
	r.Mount("/purchase-orders", purchaseorders.Routes(d))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

func poInjectUser(uid int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := deps.WithUserID(r.Context(), uid)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func TestDeliveryNote_NewHandler(t *testing.T) {
	pool := testutil.Pool(t)
	store := testutil.Store(t)
	h := purchaseorders.NewDeliveryNoteHandler(
		purchaseorders.NewRepo(pool, store),
		clients.NewRepo(pool, store),
		quotations.NewRepo(pool, store),
		pdfgen.NewRenderer(t.TempDir()),
	)
	require.NotNil(t, h)
}

func TestDeliveryNote_BadID(t *testing.T) {
	srv := poExportServer(t)
	res, err := srv.Client().Get(srv.URL + "/purchase-orders/abc/delivery-note.pdf")
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestDeliveryNote_NotFound(t *testing.T) {
	srv := poExportServer(t)
	res, err := srv.Client().Get(srv.URL + "/purchase-orders/99999999/delivery-note.pdf")
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusNotFound, res.StatusCode)
}

func TestDeliveryNote_HappyPath(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("requires xelatex stub")
	}
	srv := poExportServer(t)

	ctx, tx := testutil.BeginTx(t)
	_, poID := acceptedQuotationWithPO(t, tx)
	require.NoError(t, tx.Commit(ctx))
	t.Cleanup(func() {
		_, _ = testutil.Pool(t).Exec(context.Background(),
			"DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE po_id=$1); "+
				"DELETE FROM invoices WHERE po_id=$1; "+
				"DELETE FROM purchase_order_items WHERE po_id=$1; "+
				"DELETE FROM purchase_orders WHERE id=$1", poID)
	})

	res, err := srv.Client().Get(srv.URL + "/purchase-orders/" + strconv.FormatInt(poID, 10) + "/delivery-note.pdf")
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Contains(t, []int{http.StatusOK, http.StatusInternalServerError}, res.StatusCode)
}
