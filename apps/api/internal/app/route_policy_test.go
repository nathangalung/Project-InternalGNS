package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/rolegate"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/roles"
)

// Route policy across every role.
// Each row names the roles that reach a route; every other role gets the
// role refusal. A reached route may still answer 400, 404 or 422: ids do
// not exist and bodies are empty, so nothing is stored.
func TestRouter_RoutePolicy(t *testing.T) {
	r := mkRouter(t)
	userIDs := rbacUsers(t)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	const (
		s  = roles.Superadmin
		o  = roles.Operational
		oi = roles.OperationalInput
		f  = roles.Finance
		fi = roles.FinanceInput
	)
	all := []string{s, o, oi, f, fi}
	rows := []struct {
		method, path string
		allowed      []string
	}{
		{"GET", "/clients", all},
		{"POST", "/clients", []string{s, o, oi, f}},
		{"PUT", "/clients/999999999", []string{s, o, oi, f}},
		{"POST", "/clients/999999999/contacts", []string{s, o, oi, f}},
		{"PATCH", "/clients/999999999/contacts/1", []string{s, o, oi, f}},
		{"DELETE", "/clients/999999999/contacts/1", []string{s, o, oi, f}},
		{"GET", "/clients/999999999/logo/upload-url", []string{s, o, oi, f}},
		{"PATCH", "/clients/999999999/logo", []string{s, o, oi, f}},

		{"GET", "/items", all},
		{"POST", "/items", []string{s, o, oi}},
		{"POST", "/items/999999999/vendors", []string{s, o, oi}},
		{"GET", "/items/999999999/price-history", []string{s, o, f}},
		{"GET", "/items/recommendations?itemId=999999999", []string{s, o, oi, f}},
		{"GET", "/vendors", all},
		{"POST", "/vendors", []string{s, o, oi}},

		{"GET", "/quotations", []string{s, o, oi, f}},
		{"GET", "/quotations/export.xlsx", []string{s, o, f}},
		{"GET", "/quotations/999999999", []string{s, o, oi, f}},
		{"POST", "/quotations", []string{s, o, oi}},
		{"PUT", "/quotations/999999999", []string{s, o}},
		{"PATCH", "/quotations/999999999/status", []string{s}},
		{"POST", "/quotations/999999999/send", []string{s}},
		{"POST", "/quotations/999999999/revise", []string{s}},
		{"POST", "/quotations/999999999/lines", []string{s, o, oi}},
		{"PUT", "/quotations/999999999/lines/1", []string{s, o, oi}},
		{"PUT", "/quotations/999999999/header", []string{s, o, oi}},
		{"POST", "/quotations/999999999/requests", []string{s, o, oi}},

		{"GET", "/purchase-orders", all},
		{"GET", "/purchase-orders/export.xlsx", []string{s, o, f, fi}},
		{"GET", "/purchase-orders/999999999", all},
		{"GET", "/purchase-orders/999999999/items", all},
		{"PATCH", "/purchase-orders/999999999/status", []string{s, o}},
		{"PUT", "/purchase-orders/999999999/items", []string{s, o, oi}},
		{"PATCH", "/purchase-orders/999999999/details", []string{s, o}},
		{"GET", "/purchase-orders/999999999/upload-url", []string{s, o}},

		{"GET", "/invoices", []string{s, f, fi}},
		{"GET", "/invoices/coretax.xlsx", []string{s, f, fi}},
		{"PATCH", "/invoices/999999999/status", []string{s, f, fi}},
		{"POST", "/invoices/999999999/replacement", []string{s, f}},
		{"PATCH", "/invoices/999999999/dates", []string{s, f}},
		{"GET", "/invoices/999999999/attachment/upload-url", []string{s, f}},
		{"PATCH", "/invoices/999999999/attachment", []string{s, f}},
		{"GET", "/invoices/999999999/payment-proof/upload-url", []string{s, f, fi}},

		{"GET", "/cash-entries", []string{s, f, fi}},
		{"POST", "/cash-entries", []string{s, f, fi}},
		{"PUT", "/cash-entries/999999999", []string{s, f, fi}},
		{"GET", "/cash-entries/export.xlsx", []string{s, f}},
		{"DELETE", "/cash-entries/999999999", []string{s, f}},

		{"GET", "/dashboard/summary", all},
		{"GET", "/dashboard/export.xlsx", []string{s, f}},
		{"GET", "/dashboard/timeseries?metric=revenue", []string{s, f}},
		{"GET", "/users", []string{s}},
	}
	for _, row := range rows {
		for _, role := range all {
			reach := false
			for _, a := range row.allowed {
				reach = reach || a == role
			}
			t.Run(row.method+" "+row.path+" "+role, func(t *testing.T) {
				var body *strings.Reader
				if row.method == "GET" {
					body = strings.NewReader("")
				} else {
					body = strings.NewReader("{}")
				}
				req, err := http.NewRequest(row.method, srv.URL+"/api/v1"+row.path, body)
				require.NoError(t, err)
				req.Header.Set("Authorization", "Bearer "+mintToken(t, userIDs[role], role))
				req.Header.Set("Content-Type", "application/json")
				res, err := srv.Client().Do(req)
				require.NoError(t, err)
				defer res.Body.Close()
				if reach {
					assert.NotEqual(t, http.StatusForbidden, res.StatusCode)
					return
				}
				require.Equal(t, http.StatusForbidden, res.StatusCode)
				var p struct {
					Detail string `json:"detail"`
				}
				require.NoError(t, json.NewDecoder(res.Body).Decode(&p))
				assert.Equal(t, rolegate.RefusedDetail, p.Detail)
			})
		}
	}
}
