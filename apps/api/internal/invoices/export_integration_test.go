package invoices_test

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"os/exec"
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
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
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
	srv := exportServer(t, testutil.Pool(t), templatesRoot(t))
	res, err := srv.Client().Get(srv.URL + "/invoices/abc/pdf")
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestExport_PDF_NotFound(t *testing.T) {
	srv := exportServer(t, testutil.Pool(t), templatesRoot(t))
	res, err := srv.Client().Get(srv.URL + "/invoices/99999999/pdf")
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusNotFound, res.StatusCode)
}

// PDF renders or fails cleanly.
func TestExport_PDF_Renders(t *testing.T) {
	_, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)

	srv := exportServer(t, tx, templatesRoot(t))
	res, err := srv.Client().Get(srv.URL + "/invoices/" + itoaInv(invID) + "/pdf")
	require.NoError(t, err)
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	require.NoError(t, err)

	if _, err := exec.LookPath("xelatex"); err != nil {
		assert.Equal(t, http.StatusInternalServerError, res.StatusCode, "no xelatex: %s", body)
		assert.Contains(t, res.Header.Get("Content-Type"), "application/problem+json")
		return
	}
	require.Equal(t, http.StatusOK, res.StatusCode, string(body))
	assert.Equal(t, "application/pdf", res.Header.Get("Content-Type"))
	assert.True(t, bytes.HasPrefix(body, []byte("%PDF-")), "body is not a PDF")
}

// Pre-write PDF failures are 500.
func TestExport_PDF_Failures(t *testing.T) {
	_, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)
	path := "/invoices/" + itoaInv(invID) + "/pdf"

	cases := []struct {
		name string
		exec db.Executor
		root string
	}{
		{name: "invoice read fails", exec: testutil.FakeExec{}, root: templatesRoot(t)},
		{name: "line read fails", exec: &testutil.CountingExec{Inner: tx, FailAfter: 1}, root: templatesRoot(t)},
		{name: "template missing", exec: tx, root: t.TempDir()},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := exportServer(t, tc.exec, tc.root)
			res, err := srv.Client().Get(srv.URL + path)
			require.NoError(t, err)
			defer res.Body.Close()
			assert.Equal(t, http.StatusInternalServerError, res.StatusCode)
		})
	}
}

// PDF header prints vessel, PO.
func TestExport_PDF_Header(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	vessel := "MV Sinar & Bahari"
	_, poID, invID := deliverQuotation(t, tx, quotations.CreateRequest{
		CompanyClientID: seedCompanyID,
		DiscountPct:     "0",
		VesselName:      &vessel,
		Items: []quotations.CreateItem{{
			RequestedName: "Header Product", Qty: "1", UnitID: seedUnitID, SellingPrice: "100000",
		}},
	})
	store := testutil.Store(t)
	po, err := purchaseorders.NewRepo(tx, store).GetByID(ctx, poID)
	require.NoError(t, err)
	client, err := clients.NewRepo(tx, store).GetByID(ctx, seedCompanyID)
	require.NoError(t, err)
	repo := invoices.NewRepo(tx, store)
	inv, err := repo.GetByID(ctx, invID)
	require.NoError(t, err)
	items, err := repo.ListItems(ctx, invID)
	require.NoError(t, err)

	h := invoices.NewExportHandler(repo, clients.NewRepo(tx, store), quotations.NewRepo(tx, store),
		purchaseorders.NewRepo(tx, store), pdfgen.NewRenderer(t.TempDir()), deps.PdfSettings{})
	got := h.PDFHeaderForTest(ctx, inv, items)

	assert.Equal(t, `MV Sinar \& Bahari`, got.VesselName, "escaped for LaTeX")
	assert.Equal(t, pdfgen.LatexEscape(po.PoNumber), got.PONo)
	assert.Equal(t, po.PoDate.Format("2 January 2006"), got.PODate)
	assert.Equal(t, pdfgen.LatexEscape(pdfgen.StrDeref(client.NPWP)), got.CompanyNPWP)
	assert.Equal(t, inv.InvoiceDate.Format("2 January 2006"), got.InvoiceDate)
	assert.Equal(t, inv.DueDate.Format("2 January 2006"), got.DueDate)
}

func exportServer(t *testing.T, exec db.Executor, root string) *httptest.Server {
	t.Helper()
	d := deps.Deps{
		Pool:          exec,
		Queries:       testutil.Store(t),
		TemplatesRoot: root,
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
