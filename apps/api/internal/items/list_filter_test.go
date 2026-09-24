package items_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// kgUnitID is Kilogram.
const kgUnitID int16 = 3

// Filters narrow one token's items.
func TestHandler_List_Filters(t *testing.T) {
	token := uniqueItemName("SARING")
	inactive := false
	set := createItem(t, items.CreateItemRequest{Name: token + " A", DefaultUnitID: ptrI16(defaultUnitID)})
	kg := createItem(t, items.CreateItemRequest{Name: token + " B", DefaultUnitID: ptrI16(kgUnitID)})
	off := createItem(t, items.CreateItemRequest{Name: token + " C", DefaultUnitID: ptrI16(kgUnitID), IsActive: &inactive})
	srv := newSrv(t)

	cases := []struct {
		name  string
		query string
		want  []int64
	}{
		{"token only", "", []int64{set.ID, kg.ID, off.ID}},
		{"isActive=true", "&isActive=true", []int64{set.ID, kg.ID}},
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

// Non-ASCII names search whole.
func TestHandler_List_UnicodeName(t *testing.T) {
	name := uniqueItemName("Çağrı 東京 Ñandú")
	it := createItem(t, items.CreateItemRequest{Name: name})
	res := doJSON(t, newSrv(t), http.MethodGet, "/items/?q="+url.QueryEscape(name), nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var rows []items.Item
	require.NoError(t, json.NewDecoder(res.Body).Decode(&rows))
	require.Len(t, rows, 1)
	assert.Equal(t, it.ID, rows[0].ID)
	assert.Equal(t, name, rows[0].Name)
	assert.Equal(t, "1", res.Header.Get("X-Total-Count"))
}

// Unknown unit writes nothing.
func TestHandler_Create_UnknownUnit(t *testing.T) {
	name := uniqueItemName("SATUAN ANTAH")
	res := doJSON(t, newSrv(t), http.MethodPost, "/items/",
		items.CreateItemRequest{Name: name, DefaultUnitID: ptrI16(32000)})
	defer res.Body.Close()
	assert.Equal(t, http.StatusNotFound, res.StatusCode)
	assert.Equal(t, "application/problem+json", res.Header.Get("Content-Type"))

	var n int
	require.NoError(t, testutil.Pool(t).QueryRow(context.Background(),
		`SELECT count(*) FROM items WHERE name = $1`, name).Scan(&n))
	assert.Zero(t, n)
}
