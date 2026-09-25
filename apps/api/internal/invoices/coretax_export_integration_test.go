package invoices_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

var coretaxSettings = deps.CoretaxSettings{
	SellerTIN:   "9999999999999999",
	SellerIDTKU: "9999999999999999000000",
}

// exportCoretaxXML calls the routed export.
func exportCoretaxXML(t *testing.T, tx pgx.Tx, invoiceID int64) *httptest.ResponseRecorder {
	t.Helper()
	store := testutil.Store(t)
	h := invoices.NewCoretaxHandler(
		invoices.NewRepo(tx, store), clients.NewRepo(tx, store), coretaxSettings, "")

	req := httptest.NewRequest(http.MethodGet, "/invoices/"+strconv.FormatInt(invoiceID, 10)+"/coretax.xml", nil)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", strconv.FormatInt(invoiceID, 10))
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

	rec := httptest.NewRecorder()
	h.Export(rec, req)
	return rec
}

// Export needs an Indonesian NPWP.
// Filing an Indonesian buyer as a passport holder produces a tax invoice DJP
// cannot match to the buyer.
func TestCoretaxExport_RefusesIndonesianBuyerWithoutNPWP(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)

	rec := exportCoretaxXML(t, tx, invID)
	assert.Equal(t, http.StatusOK, rec.Code, "seeded client carries a valid NPWP: %s", rec.Body.String())

	_, err := tx.Exec(ctx, `UPDATE company_client SET npwp = NULL WHERE id = $1`, seedCompanyID)
	require.NoError(t, err)

	rec = exportCoretaxXML(t, tx, invID)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Contains(t, rec.Body.String(), "NPWP")
}

func TestCoretaxExport_RefusesIndonesianBuyerWithShortNPWP(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)

	_, err := tx.Exec(ctx, `UPDATE company_client SET npwp = '012345678901234' WHERE id = $1`, seedCompanyID)
	require.NoError(t, err)

	rec := exportCoretaxXML(t, tx, invID)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}
