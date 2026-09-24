package items_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
)

// kgUnitID is the seeded KG unit.
const kgUnitID int16 = 3

// Filters narrow one token's items.
func TestHandler_List_Filters(t *testing.T) {
	token := uniqueItemName("SARING")
	inactive := false
	pcs := createItem(t, items.CreateItemRequest{Name: token + " A", DefaultUnitID: ptrI16(defaultUnitID)})
	kg := createItem(t, items.CreateItemRequest{Name: token + " B", DefaultUnitID: ptrI16(kgUnitID)})
	off := createItem(t, items.CreateItemRequest{Name: token + " C", DefaultUnitID: ptrI16(kgUnitID), IsActive: &inactive})
	srv := newSrv(t)

	cases := []struct {
		name  string
		query string
		want  []int64
	}{
		{"token only", "", []int64{pcs.ID, kg.ID, off.ID}},
		{"isActive=true", "&isActive=true", []int64{pcs.ID, kg.ID}},
		{"isActive=false", "&isActive=false", []int64{off.ID}},
		{"unitId", fmt.Sprintf("&unitId=%d", kgUnitID), []int64{kg.ID, off.ID}},
		{"unitId and active", fmt.Sprintf("&unitId=%d&isActive=1", kgUnitID), []int64{kg.ID}},
		{"unknown unit", "&unitId=32000", nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := doJSON(t, srv, http.MethodGet, "/items/?q="+url.QueryEscape(token)+c.query, nil)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			var rows []items.Item
			require.NoError(t, json.NewDecoder(res.Body).Decode(&rows))
			got := make([]int64, 0, len(rows))
			for _, r := range rows {
				got = append(got, r.ID)
			}
			assert.ElementsMatch(t, c.want, got)
			assert.Equal(t, fmt.Sprint(len(c.want)), res.Header.Get("X-Total-Count"))
		})
	}
}

// Sort follows the whitelist.
func TestHandler_List_SortByIMPA(t *testing.T) {
	token := uniqueItemName("URUT")
	z := "ZZ" + uniqueIMPA()
	a := "AA" + uniqueIMPA()
	later := createItem(t, items.CreateItemRequest{Name: token + " 1", IMPACode: &z})
	first := createItem(t, items.CreateItemRequest{Name: token + " 2", IMPACode: &a})

	for _, dir := range []struct {
		dir  string
		want []int64
	}{
		{"asc", []int64{first.ID, later.ID}},
		{"desc", []int64{later.ID, first.ID}},
	} {
		t.Run(dir.dir, func(t *testing.T) {
			res := doJSON(t, newSrv(t), http.MethodGet,
				"/items/?q="+url.QueryEscape(token)+"&sortBy=impaCode&sortDir="+dir.dir, nil)
			defer res.Body.Close()
			var rows []items.Item
			require.NoError(t, json.NewDecoder(res.Body).Decode(&rows))
			got := make([]int64, 0, len(rows))
			for _, r := range rows {
				got = append(got, r.ID)
			}
			assert.Equal(t, dir.want, got)
		})
	}
}
