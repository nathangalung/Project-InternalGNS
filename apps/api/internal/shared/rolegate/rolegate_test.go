package rolegate_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/rolegate"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/roles"
)

func TestDeny(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	h := rolegate.Deny(roles.OperationalInput, roles.FinanceInput)(next)
	tests := []struct {
		role string
		want int
	}{
		{roles.Superadmin, http.StatusOK},
		{roles.Operational, http.StatusOK},
		{roles.OperationalInput, http.StatusForbidden},
		{roles.FinanceInput, http.StatusForbidden},
	}
	for _, tt := range tests {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req = req.WithContext(deps.WithUserRole(req.Context(), tt.role))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		assert.Equal(t, tt.want, rec.Code, tt.role)
		if tt.want == http.StatusForbidden {
			var p struct {
				Detail string `json:"detail"`
			}
			assert.NoError(t, json.NewDecoder(rec.Body).Decode(&p))
			assert.Equal(t, rolegate.RefusedDetail, p.Detail)
		}
	}
}
