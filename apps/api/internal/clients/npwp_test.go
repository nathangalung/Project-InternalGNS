package clients_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Indonesian NPWP is 16 digits.
// A malformed one used to save and only fail later, at the Coretax export
// of an invoice already issued; a foreign buyer keeps its own tax id.
func TestHandler_ClientNPWP(t *testing.T) {
	cleaner := testutil.NewCleaner(t)
	srv := newSrv(t)
	const msg = "NPWP harus 16 digit angka."

	cases := []struct {
		name    string
		country string
		npwp    string
		want    int
	}{
		{"indonesian 15 digits refused", "IDN", "01.234.567.8-901.000", http.StatusUnprocessableEntity},
		{"indonesian 16 digits saved", "IDN", "01.234.567.89.012.345", http.StatusCreated},
		{"foreign tax id saved", "SGP", "T08LL1234A", http.StatusCreated},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			body := map[string]any{
				"name":        fmt.Sprintf("PT NPWP %d", time.Now().UnixNano()),
				"countryCode": tc.country,
				"npwp":        tc.npwp,
			}
			res := doJSON(t, srv, http.MethodPost, "/clients/", body)
			defer res.Body.Close()
			require.Equal(t, tc.want, res.StatusCode)
			if tc.want == http.StatusCreated {
				var c struct {
					ID   int64
					NPWP string
				}
				require.NoError(t, json.NewDecoder(res.Body).Decode(&c))
				cleaner.Client(c.ID)
				if tc.country == "IDN" {
					assert.Equal(t, "0123456789012345", c.NPWP, "stored as digits")
				}
				return
			}
			var problem httperr.Error
			require.NoError(t, json.NewDecoder(res.Body).Decode(&problem))
			assert.Equal(t, msg, problem.Fields["npwp"])
		})
	}

	t.Run("update refuses too", func(t *testing.T) {
		res := doJSON(t, srv, http.MethodPost, "/clients/", map[string]any{
			"name": fmt.Sprintf("PT NPWP %d", time.Now().UnixNano()), "countryCode": "IDN",
		})
		defer res.Body.Close()
		require.Equal(t, http.StatusCreated, res.StatusCode)
		var c struct {
			ID   int64
			Name string
		}
		require.NoError(t, json.NewDecoder(res.Body).Decode(&c))
		cleaner.Client(c.ID)

		up := doJSON(t, srv, http.MethodPut, fmt.Sprintf("/clients/%d", c.ID), map[string]any{
			"name": c.Name, "countryCode": "IDN", "npwp": "12345", "isActive": true,
		})
		defer up.Body.Close()
		require.Equal(t, http.StatusUnprocessableEntity, up.StatusCode)
		var problem httperr.Error
		require.NoError(t, json.NewDecoder(up.Body).Decode(&problem))
		assert.Equal(t, msg, problem.Fields["npwp"])
	})
}
