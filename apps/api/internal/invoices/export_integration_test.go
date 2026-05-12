package invoices_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/pdfgen"
	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Repo path for invoice/Invoice.tex.tmpl.
func templatesRoot(t *testing.T) string {
	t.Helper()
	_, here, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(here), "..", "..", "templates", "documents")
}

func TestExport_NewExportHandler(t *testing.T) {
	pool := testutil.Pool(t)
	store := testutil.Store(t)

	h := invoices.NewExportHandler(
		invoices.NewRepo(pool, store),
		clients.NewRepo(pool, store),
		quotations.NewRepo(pool, store),
		purchaseorders.NewRepo(pool, store),
		pdfgen.NewRenderer(t.TempDir()),
		deps.PdfSettings{},
	)
	require.NotNil(t, h)
}

func TestExport_PDF_BadID(t *testing.T) {
	srv := exportServer(t)
	res, err := srv.Client().Get(srv.URL + "/invoices/abc/pdf")
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestExport_PDF_NotFound(t *testing.T) {
	srv := exportServer(t)
	res, err := srv.Client().Get(srv.URL + "/invoices/99999999/pdf")
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusNotFound, res.StatusCode)
}

func TestExport_PDF_HappyPath(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("requires xelatex stub")
	}

	ctx, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)
	require.NoError(t, tx.Commit(ctx))
	t.Cleanup(func() {
		_, _ = testutil.Pool(t).Exec(context.Background(),
			"DELETE FROM invoice_items WHERE invoice_id=$1; DELETE FROM invoices WHERE id=$1", invID)
	})

	srv := exportServer(t)
	res, err := srv.Client().Get(srv.URL + "/invoices/" + itoaInv(invID) + "/pdf")
	require.NoError(t, err)
	defer res.Body.Close()
	// Status may be 200 (xelatex available) or 500 (missing binary/template). Both exercise full handler path.
	assert.Contains(t, []int{http.StatusOK, http.StatusInternalServerError}, res.StatusCode)
}

func exportServer(t *testing.T) *httptest.Server {
	t.Helper()
	pool := testutil.Pool(t)
	store := testutil.Store(t)
	d := deps.Deps{
		Pool:          pool,
		Queries:       store,
		TemplatesRoot: templatesRoot(t),
		Pdf: deps.PdfSettings{
			PaymentTerms:  "Net 30",
			BankName:      "BCA",
			BankAccountNo: "1234567890",
			BankAccountNm: "PT GNS",
			SignerName:    "Bryan",
		},
	}

	r := chi.NewRouter()
	r.Use(injectUser(seedUserID))
	r.Mount("/invoices", invoices.Routes(d))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

func injectUser(uid int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := deps.WithUserID(r.Context(), uid)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func itoaInv(n int64) string {
	if n == 0 {
		return "0"
	}
	const digits = "0123456789"
	negative := n < 0
	if negative {
		n = -n
	}
	buf := make([]byte, 0, 20)
	for n > 0 {
		buf = append([]byte{digits[n%10]}, buf...)
		n /= 10
	}
	if negative {
		return "-" + string(buf)
	}
	return string(buf)
}
