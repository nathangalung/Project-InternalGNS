package app

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/roles"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Master data by role.
// Finance input sees no cost figure on vendors and products, operational
// input no selling figure on clients, and finance input only reads a
// client. Keys are checked by presence, so a hidden figure is
// absent, not zero.
func TestRouter_MasterDataByRole(t *testing.T) {
	srv := httptest.NewServer(mkRouter(t))
	t.Cleanup(srv.Close)
	ids := rbacUsers(t)
	cleaner := testutil.NewCleaner(t)

	call := func(role, method, path string, body any) (int, []byte) {
		t.Helper()
		var rdr *bytes.Reader
		if body != nil {
			raw, err := json.Marshal(body)
			require.NoError(t, err)
			rdr = bytes.NewReader(raw)
		} else {
			rdr = bytes.NewReader(nil)
		}
		req, err := http.NewRequest(method, srv.URL+"/api/v1"+path, rdr)
		require.NoError(t, err)
		req.Header.Set("Authorization", "Bearer "+mintToken(t, ids[role], role))
		req.Header.Set("Content-Type", "application/json")
		res, err := srv.Client().Do(req)
		require.NoError(t, err)
		defer res.Body.Close()
		var buf bytes.Buffer
		_, _ = buf.ReadFrom(res.Body)
		return res.StatusCode, buf.Bytes()
	}
	created := func(path string, body any) int64 {
		t.Helper()
		code, raw := call(roles.Superadmin, http.MethodPost, path, body)
		require.Equal(t, http.StatusCreated, code, string(raw))
		var v struct {
			ID              int64 `json:"id"`
			VendorProductID int64 `json:"vendorProductId"`
		}
		require.NoError(t, json.Unmarshal(raw, &v))
		if v.ID == 0 {
			return v.VendorProductID
		}
		return v.ID
	}
	stamp := time.Now().UnixNano()
	vendor := created("/vendors", map[string]any{"name": fmt.Sprintf("Vendor Peran %d", stamp)})
	cleaner.Vendor(vendor)
	item := created("/items", map[string]any{"name": fmt.Sprintf("Barang Peran %d", stamp)})
	cleaner.Item(item)
	created(fmt.Sprintf("/items/%d/vendors", item), map[string]any{"vendorId": vendor, "costPrice": "75000"})
	client := created("/clients", map[string]any{"name": fmt.Sprintf("PT Peran %d", stamp), "countryCode": "IDN"})
	cleaner.Client(client)

	keys := func(raw []byte) []map[string]any {
		t.Helper()
		var many []map[string]any
		if json.Unmarshal(raw, &many) == nil {
			return many
		}
		var one map[string]any
		require.NoError(t, json.Unmarshal(raw, &one))
		return []map[string]any{one}
	}
	present := func(role, path, key string) bool {
		t.Helper()
		code, raw := call(role, http.MethodGet, path, nil)
		require.Equal(t, http.StatusOK, code, "%s %s", role, path)
		rows := keys(raw)
		require.NotEmpty(t, rows, path)
		_, ok := rows[0][key]
		return ok
	}

	for _, tt := range []struct {
		role          string
		cost, selling bool
	}{
		{roles.Superadmin, true, true},
		{roles.OperationalInput, true, false},
		{roles.Finance, true, true},
		{roles.FinanceInput, false, true},
	} {
		t.Run(tt.role, func(t *testing.T) {
			assert.Equal(t, tt.cost, present(tt.role, fmt.Sprintf("/vendors/%d", vendor), "totalPurchase"))
			assert.Equal(t, tt.cost, present(tt.role, fmt.Sprintf("/vendors/%d/items", vendor), "costPrice"))
			assert.Equal(t, tt.cost, present(tt.role, fmt.Sprintf("/items/%d/vendors", item), "costPrice"))
			assert.Equal(t, tt.selling, present(tt.role, fmt.Sprintf("/clients/%d", client), "totalPurchase"))

			probes := map[string]bool{
				"/vendors?minTotal=1":           tt.cost,
				"/vendors?sortBy=totalPurchase": tt.cost,
				"/clients?minTotal=1":           tt.selling,
				"/clients?sortBy=totalPurchase": tt.selling,
			}
			for path, ok := range probes {
				code, _ := call(tt.role, http.MethodGet, path, nil)
				if ok {
					assert.Equal(t, http.StatusOK, code, path)
				} else {
					assert.Equal(t, http.StatusForbidden, code, path)
				}
			}
		})
	}

	// Finance input reads clients; the finance head fixes them.
	code, _ := call(roles.FinanceInput, http.MethodPut, fmt.Sprintf("/clients/%d", client), map[string]any{
		"name": "Nama Diganti", "countryCode": "IDN", "npwp": "0123456789012345", "isActive": false,
	})
	assert.Equal(t, http.StatusForbidden, code)
	code, raw := call(roles.Finance, http.MethodPut, fmt.Sprintf("/clients/%d", client), map[string]any{
		"name": fmt.Sprintf("PT Peran %d", stamp), "countryCode": "IDN", "npwp": "0123456789012345", "isActive": true,
	})
	require.Equal(t, http.StatusOK, code, string(raw))
}
