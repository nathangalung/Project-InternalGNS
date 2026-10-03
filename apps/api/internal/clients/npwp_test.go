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

// A blank country keeps the stored one.
// The update SQL keeps the client's country, so the NPWP is checked and
// stored against it, not against IDN.
func TestHandler_UpdateNPWP_StoredCountry(t *testing.T) {
	cleaner := testutil.NewCleaner(t)
	srv := newSrv(t)
	create := func(country, npwp string) (int64, string) {
		t.Helper()
		name := fmt.Sprintf("PT Negara %d", time.Now().UnixNano())
		res := doJSON(t, srv, http.MethodPost, "/clients/", map[string]any{
			"name": name, "countryCode": country, "npwp": npwp,
		})
		defer res.Body.Close()
		require.Equal(t, http.StatusCreated, res.StatusCode)
		var c struct{ ID int64 }
		require.NoError(t, json.NewDecoder(res.Body).Decode(&c))
		cleaner.Client(c.ID)
		return c.ID, name
	}
	put := func(id int64, name, npwp string) *http.Response {
		t.Helper()
		return doJSON(t, srv, http.MethodPut, fmt.Sprintf("/clients/%d", id), map[string]any{
			"name": name + " Baru", "npwp": npwp, "isActive": true,
		})
	}

	t.Run("foreign client keeps its tax id", func(t *testing.T) {
		id, name := create("SGP", "T08GB0001A")
		res := put(id, name, "T08-GB-0001A")
		defer res.Body.Close()
		require.Equal(t, http.StatusOK, res.StatusCode)
		var c struct{ CountryCode, NPWP string }
		require.NoError(t, json.NewDecoder(res.Body).Decode(&c))
		assert.Equal(t, "SGP", c.CountryCode)
		assert.Equal(t, "T08-GB-0001A", c.NPWP, "a foreign id is stored as given")
	})

	t.Run("indonesian client still checked", func(t *testing.T) {
		id, name := create("IDN", "")
		res := put(id, name, "12345")
		defer res.Body.Close()
		require.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
		var problem httperr.Error
		require.NoError(t, json.NewDecoder(res.Body).Decode(&problem))
		assert.Equal(t, "NPWP harus 16 digit angka.", problem.Fields["npwp"])
	})

	t.Run("unknown client", func(t *testing.T) {
		res := put(99999999, "PT Hilang", "T08GB0001A")
		defer res.Body.Close()
		assert.Equal(t, http.StatusNotFound, res.StatusCode)
	})
}
