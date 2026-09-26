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

// Non-ASCII names search whole.
func TestHandler_List_UnicodeName(t *testing.T) {
	token := fmt.Sprintf("Çağrı 東京 Ñandú %d", time.Now().UnixNano())
	id := insertVendor(t, "CV "+token, "Jakarta", true)
	res := doJSON(t, newSrv(t), http.MethodGet, "/vendors/?q="+url.QueryEscape(token), nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var rows []vendors.Vendor
	require.NoError(t, json.NewDecoder(res.Body).Decode(&rows))
	require.Len(t, rows, 1)
	assert.Equal(t, id, rows[0].ID)
	assert.Equal(t, "CV "+token, rows[0].Name)
	assert.Equal(t, "1", res.Header.Get("X-Total-Count"))
}
