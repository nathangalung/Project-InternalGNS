package invoices_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// coretaxRouter mounts routes for Coretax.
func coretaxRouter(t *testing.T, exec db.Executor, settings deps.CoretaxSettings, root string) http.Handler {
	t.Helper()
	r := chi.NewRouter()
	r.Use(injectUser(seedUserID))
	r.Mount("/invoices", invoices.Routes(deps.Deps{
		Pool: exec, Queries: testutil.Store(t), Coretax: settings, TemplatesRoot: root,
	}))
	return r
}

// serve runs one GET.
func serve(h http.Handler, path string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

func problemDetail(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var p struct {
		Detail string `json:"detail"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &p), rec.Body.String())
	return p.Detail
}

// XML export failure statuses.
func TestCoretaxXML_Refusals(t *testing.T) {
	_, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)
	path := "/invoices/" + strconv.FormatInt(invID, 10) + "/coretax.xml"

	cases := []struct {
		name     string
		exec     db.Executor
		settings deps.CoretaxSettings
		path     string
		want     int
	}{
		{name: "seller TIN missing", exec: tx, settings: deps.CoretaxSettings{SellerIDTKU: "x"}, path: path, want: http.StatusServiceUnavailable},
		{name: "bad id", exec: tx, settings: coretaxSettings, path: "/invoices/abc/coretax.xml", want: http.StatusBadRequest},
		{name: "unknown invoice", exec: tx, settings: coretaxSettings, path: "/invoices/99999999/coretax.xml", want: http.StatusNotFound},
		{name: "invoice read fails", exec: testutil.FakeExec{}, settings: coretaxSettings, path: path, want: http.StatusInternalServerError},
		{name: "line read fails", exec: &testutil.CountingExec{Inner: tx, FailAfter: 1}, settings: coretaxSettings, path: path, want: http.StatusInternalServerError},
		{name: "buyer read fails", exec: &testutil.CountingExec{Inner: tx, FailAfter: 2}, settings: coretaxSettings, path: path, want: http.StatusInternalServerError},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := serve(coretaxRouter(t, tc.exec, tc.settings, ""), tc.path)
			assert.Equal(t, tc.want, rec.Code, rec.Body.String())
		})
	}
}

// XML export names the file.
func TestCoretaxXML_NamesTheFile(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)
	inv, err := invoices.NewRepo(tx, testutil.Store(t)).GetByID(ctx, invID)
	require.NoError(t, err)

	rec := serve(coretaxRouter(t, tx, coretaxSettings, ""), "/invoices/"+strconv.FormatInt(invID, 10)+"/coretax.xml")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, "application/xml; charset=utf-8", rec.Header().Get("Content-Type"))
	assert.Equal(t, `attachment; filename="`+inv.InvoiceNo+`.xml"`, rec.Header().Get("Content-Disposition"))
	assert.Contains(t, rec.Body.String(), "<RefDesc>"+inv.InvoiceNo+"</RefDesc>")
}

// Bulk XLSX failure statuses.
func TestCoretaxXLSX_Refusals(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	// No other buyer may trip the NPWP check first.
	require.NoError(t, testutil.ResetCommercialDomain(ctx, tx))
	deliveredPOWithInvoice(t, tx)
	templates := templatesRoot(t)
	corrupt := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(corrupt, "coretax"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(corrupt, "coretax", "coretax_export_2026.xlsx"), []byte("not a workbook"), 0o600))

	cases := []struct {
		name   string
		exec   db.Executor
		root   string
		want   int
		detail string
	}{
		{name: "templates not configured", exec: tx, root: "", want: http.StatusServiceUnavailable},
		{name: "list read fails", exec: testutil.FakeExec{}, root: templates, want: http.StatusInternalServerError},
		{name: "line read fails", exec: &testutil.CountingExec{Inner: tx, FailAfter: 2}, root: templates, want: http.StatusInternalServerError},
		{name: "buyer read fails", exec: &testutil.CountingExec{Inner: tx, FailAfter: 3}, root: templates, want: http.StatusInternalServerError},
		{name: "template missing", exec: tx, root: t.TempDir(), want: http.StatusInternalServerError, detail: "coretax template unavailable"},
		{name: "template corrupt", exec: tx, root: corrupt, want: http.StatusInternalServerError, detail: "coretax workbook build failed"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := serve(coretaxRouter(t, tc.exec, coretaxSettings, tc.root), "/invoices/coretax.xlsx")
			assert.Equal(t, tc.want, rec.Code, rec.Body.String())
			if tc.detail != "" {
				assert.Equal(t, tc.detail, problemDetail(t, rec))
			}
		})
	}
}

// Refusal names each buyer once.
func TestCoretaxXLSX_RefusesBuyerWithoutNPWPOnce(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	require.NoError(t, testutil.ResetCommercialDomain(ctx, tx))
	deliveredPOWithInvoice(t, tx)
	deliveredPOWithInvoice(t, tx)
	var name string
	require.NoError(t, tx.QueryRow(ctx,
		`UPDATE company_client SET npwp = NULL, country_code = 'IDN' WHERE id = $1 RETURNING name`, seedCompanyID).Scan(&name))

	rec := serve(coretaxRouter(t, tx, coretaxSettings, templatesRoot(t)), "/invoices/coretax.xlsx")
	require.Equal(t, http.StatusUnprocessableEntity, rec.Code, rec.Body.String())
	assert.Equal(t,
		"Ekspor Coretax memerlukan NPWP 16 digit untuk pembeli Indonesia. Lengkapi NPWP klien: "+name+".",
		problemDetail(t, rec))
}

// Line-less invoices are skipped.
func TestCoretaxXLSX_SkipsInvoiceWithoutLines(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	require.NoError(t, testutil.ResetCommercialDomain(ctx, tx))
	_, _, empty := deliveredPOWithInvoice(t, tx)
	_, _, filed := deliveredPOWithInvoice(t, tx)
	_, err := tx.Exec(ctx, `DELETE FROM invoice_items WHERE invoice_id = $1`, empty)
	require.NoError(t, err)
	inv, err := invoices.NewRepo(tx, testutil.Store(t)).GetByID(ctx, filed)
	require.NoError(t, err)

	rec := serve(coretaxRouter(t, tx, coretaxSettings, templatesRoot(t)), "/invoices/coretax.xlsx")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	f, err := excelize.OpenReader(bytes.NewReader(rec.Body.Bytes()))
	require.NoError(t, err)
	defer func() { _ = f.Close() }()
	rows, err := f.GetRows("Faktur")
	require.NoError(t, err)
	refs := []string{}
	for _, row := range rows[3:] {
		if len(row) > 7 && row[0] != "" {
			refs = append(refs, row[7])
		}
	}
	assert.Equal(t, []string{inv.InvoiceNo}, refs, "only the invoice with lines is filed")
}

// Bulk export follows list filter.
func TestCoretaxXLSX_FollowsTheListFilter(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	fx := seedListFixture(t, ctx, tx)

	rec := serve(coretaxRouter(t, tx, coretaxSettings, templatesRoot(t)),
		"/invoices/coretax.xlsx?q="+url.QueryEscape(fx.sent.InvoiceNo))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	f, err := excelize.OpenReader(bytes.NewReader(rec.Body.Bytes()))
	require.NoError(t, err)
	defer func() { _ = f.Close() }()
	detail, err := f.GetRows("DetailFaktur")
	require.NoError(t, err)
	require.Len(t, detail, 2, "header plus the one line of the filtered invoice")
	assert.Equal(t, fx.sent.InvoiceNo, detail[1][14])
}
