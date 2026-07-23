package dashboard_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/dashboard"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

func newSrv(t *testing.T) *httptest.Server {
	t.Helper()
	return testutil.DashboardServer(t)
}

func TestHandler_Summary(t *testing.T) {
	srv := newSrv(t)
	res, err := srv.Client().Get(srv.URL + "/dashboard/summary")
	require.NoError(t, err)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var s dashboard.Summary
	require.NoError(t, json.NewDecoder(res.Body).Decode(&s))
}

func TestHandler_Timeseries_HappyPath(t *testing.T) {
	srv := newSrv(t)
	res, err := srv.Client().Get(srv.URL + "/dashboard/timeseries?metric=quotation&from=2025-01-01&to=2026-01-01")
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_Timeseries_AllValidMetrics(t *testing.T) {
	srv := newSrv(t)
	for _, m := range []string{"quotation", "invoice", "revenue", "profit", "ppn"} {
		t.Run(m, func(t *testing.T) {
			res, err := srv.Client().Get(srv.URL + "/dashboard/timeseries?metric=" + m + "&from=2025-01-01&to=2026-01-01")
			require.NoError(t, err)
			defer res.Body.Close()
			assert.Equal(t, http.StatusOK, res.StatusCode)
		})
	}
}

func TestHandler_Timeseries_DefaultRange(t *testing.T) {
	srv := newSrv(t)
	res, err := srv.Client().Get(srv.URL + "/dashboard/timeseries?metric=quotation")
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_Timeseries_MissingMetric(t *testing.T) {
	srv := newSrv(t)
	res, err := srv.Client().Get(srv.URL + "/dashboard/timeseries")
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Timeseries_UnknownMetric(t *testing.T) {
	srv := newSrv(t)
	res, err := srv.Client().Get(srv.URL + "/dashboard/timeseries?metric=banana")
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Timeseries_BadFromDate(t *testing.T) {
	srv := newSrv(t)
	res, err := srv.Client().Get(srv.URL + "/dashboard/timeseries?metric=quotation&from=junk")
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Timeseries_BadToDate(t *testing.T) {
	srv := newSrv(t)
	res, err := srv.Client().Get(srv.URL + "/dashboard/timeseries?metric=quotation&to=junk")
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Timeseries_RangeInverted(t *testing.T) {
	srv := newSrv(t)
	res, err := srv.Client().Get(srv.URL + "/dashboard/timeseries?metric=quotation&from=2026-01-01&to=2025-01-01")
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Timeseries_EqualRange(t *testing.T) {
	srv := newSrv(t)
	res, err := srv.Client().Get(srv.URL + "/dashboard/timeseries?metric=quotation&from=2025-06-01&to=2025-06-01")
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Summary_OperationalStripsFinancial(t *testing.T) {
	srv := testutil.DashboardServerAs(t, "operational")
	res, err := srv.Client().Get(srv.URL + "/dashboard/summary")
	require.NoError(t, err)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var s dashboard.Summary
	require.NoError(t, json.NewDecoder(res.Body).Decode(&s))
	assert.Equal(t, "0", s.TotalRevenue)
	assert.Equal(t, "0", s.TotalExpenses)
	assert.Equal(t, "0", s.TotalProfit)
	assert.Equal(t, "0", s.TotalPpn)
	assert.Zero(t, s.TotalInvoices)
	assert.Zero(t, s.TotalInvoicesPaid)
	assert.Zero(t, s.InvoicesDueSoon)
	assert.Zero(t, s.InvoicesOverdue)
}

func TestHandler_Timeseries_OperationalForbidsFinancial(t *testing.T) {
	srv := testutil.DashboardServerAs(t, "operational")
	for _, m := range []string{"revenue", "profit", "ppn", "invoice"} {
		t.Run(m, func(t *testing.T) {
			res, err := srv.Client().Get(srv.URL + "/dashboard/timeseries?metric=" + m)
			require.NoError(t, err)
			defer res.Body.Close()
			assert.Equal(t, http.StatusForbidden, res.StatusCode)
		})
	}
}

func TestHandler_Timeseries_OperationalAllowsQuotation(t *testing.T) {
	srv := testutil.DashboardServerAs(t, "operational")
	res, err := srv.Client().Get(srv.URL + "/dashboard/timeseries?metric=quotation")
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_Export_OperationalForbidden(t *testing.T) {
	srv := testutil.DashboardServerAs(t, "operational")
	res, err := srv.Client().Get(srv.URL + "/dashboard/export.xlsx")
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusForbidden, res.StatusCode)
}
