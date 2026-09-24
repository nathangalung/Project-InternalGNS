package vendors_test

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/vendors"
)

// Filters narrow one token's vendors.
func TestHandler_List_Filters(t *testing.T) {
	token := fmt.Sprintf("Saring%d", time.Now().UnixNano())
	active := insertVendor(t, "CV "+token+" Aktif", "Gudang "+token+"-JKT, Indonesia", true)
	inactive := insertVendor(t, "PT "+token+" Pasif", "Jurong, Singapore", false)
	srv := newSrv(t)

	cases := []struct {
		name  string
		query string
		want  []int64
	}{
		{"name token", "q=" + token, []int64{active, inactive}},
		{"location only", "q=" + token + "-JKT", []int64{active}},
		{"isActive=1", "q=" + token + "&isActive=1", []int64{active}},
		{"isActive=0", "q=" + token + "&isActive=0", []int64{inactive}},
		{"isActive=false", "q=" + token + "&isActive=false", []int64{inactive}},
		{"countryName", "q=" + token + "&countryName=singapore", []int64{inactive}},
		{"minTotal zero keeps unquoted", "q=" + token + "&minTotal=0", []int64{active, inactive}},
		{"minTotal above zero drops unquoted", "q=" + token + "&minTotal=0.01", nil},
		{"no match", "q=" + url.QueryEscape(token+" tidak ada"), nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := doJSON(t, srv, http.MethodGet, "/vendors/?"+c.query, nil)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			raw, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			// An empty page is a JSON array, never null.
			assert.True(t, strings.HasPrefix(string(raw), "["), string(raw))
			var rows []vendors.Vendor
			require.NoError(t, json.Unmarshal(raw, &rows))
			got := make([]int64, 0, len(rows))
			for _, r := range rows {
				got = append(got, r.ID)
			}
			assert.ElementsMatch(t, c.want, got)
			assert.Equal(t, fmt.Sprint(len(c.want)), res.Header.Get("X-Total-Count"))
		})
	}
}
