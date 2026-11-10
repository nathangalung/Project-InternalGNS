package invoices_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
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
	cases := []struct {
		name string
		exec db.Executor
	}{
		{name: "list read fails", exec: testutil.FakeExec{}},
		{name: "line read fails", exec: &testutil.CountingExec{Inner: tx, FailAfter: 2}},
		{name: "buyer read fails", exec: &testutil.CountingExec{Inner: tx, FailAfter: 3}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := serve(coretaxRouter(t, tc.exec, coretaxSettings, templatesRoot(t)), "/invoices/coretax.xlsx")
			assert.Equal(t, http.StatusInternalServerError, rec.Code, rec.Body.String())
		})
	}
}

// Refusal names each invoice.
// The invoiced NPWP is what is filed, so completing the client later does
// not clear the refusal.
func TestCoretaxXLSX_RefusesInvoicesWithoutNPWP(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	require.NoError(t, testutil.ResetCommercialDomain(ctx, tx))
	_, _, first := deliveredPOWithInvoice(t, tx)
	_, _, second := deliveredPOWithInvoice(t, tx)
	var numbers string
	require.NoError(t, tx.QueryRow(ctx, `
		WITH blanked AS (
			UPDATE invoices SET buyer_npwp = NULL WHERE id IN ($1, $2) RETURNING id, invoice_no
		)
		SELECT string_agg(invoice_no, ', ' ORDER BY id DESC) FROM blanked`, first, second).Scan(&numbers))

	rec := serve(coretaxRouter(t, tx, coretaxSettings, templatesRoot(t)), "/invoices/coretax.xlsx")
	require.Equal(t, http.StatusUnprocessableEntity, rec.Code, rec.Body.String())
	assert.Equal(t,
		"Ekspor Coretax butuh NPWP 16 digit untuk pembeli Indonesia. "+
			"Lengkapi NPWP klien, "+
			"lalu batalkan dan terbitkan ulang invoice berikut: "+numbers+".",
		problemDetail(t, rec))
}

// A TKU on another NPWP is refused.
// The client's NPWP changed after issue: an open invoice goes through a
// Pengganti, a paid one is named to leave out.
func TestCoretaxXML_RefusesTKUOfAnotherNPWP(t *testing.T) {
	cases := []struct {
		name, status, want string
	}{
		{"open", "sent", "NPWP klien berubah setelah invoice terbit, jadi ID TKU klien tidak cocok dengan NPWP di invoice. " +
			"Batalkan lalu terbitkan Pengganti untuk invoice berikut: %s."},
		{"paid", "paid", "Invoice lunas berikut tidak menyimpan NPWP pembeli yang cocok untuk Coretax dan tidak dapat diubah lagi: " +
			"%s. Pilih periode ekspor yang tidak memuatnya."},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			_, _, invID := deliveredPOWithInvoice(t, tx)
			var number string
			require.NoError(t, tx.QueryRow(ctx, `
				UPDATE invoices SET status = $2::TEXT, paid_at = CASE WHEN $2::TEXT = 'paid' THEN NOW() END
				WHERE id = $1 RETURNING invoice_no`, invID, tc.status).Scan(&number))
			_, err := tx.Exec(ctx, `
				UPDATE company_client SET tku_id = '9999999999999999000000'
				WHERE id = (SELECT company_client_id FROM invoices WHERE id = $1)`, invID)
			require.NoError(t, err)

			rec := serve(coretaxRouter(t, tx, coretaxSettings, ""), "/invoices/"+strconv.FormatInt(invID, 10)+"/coretax.xml")
			require.Equal(t, http.StatusUnprocessableEntity, rec.Code, rec.Body.String())
			assert.Equal(t, fmt.Sprintf(tc.want, number), problemDetail(t, rec))
		})
	}
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
	require.Len(t, detail, 3, "header, the one line of the filtered invoice and END")
	assert.Equal(t, "1", detail[1][0], "the line names the one faktur")
	rows, err := f.GetRows("Faktur")
	require.NoError(t, err)
	assert.Equal(t, fx.sent.InvoiceNo, rows[3][7])
}
