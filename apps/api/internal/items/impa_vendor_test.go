package items_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// uniqueIMPA returns a fresh code.
// The code is lowercase.
// The active-code index is unique, so a literal would collide across runs.
func uniqueIMPA() string {
	return fmt.Sprintf("zt%d", time.Now().UnixNano()%1_000_000_000_000)
}

// createItem posts a tracked item.
func createItem(t *testing.T, req items.CreateItemRequest) items.Item {
	t.Helper()
	res := doJSON(t, newSrv(t), http.MethodPost, "/items/", req)
	defer res.Body.Close()
	require.Equal(t, http.StatusCreated, res.StatusCode)
	var it items.Item
	require.NoError(t, json.NewDecoder(res.Body).Decode(&it))
	testutil.NewCleaner(t).Item(it.ID)
	return it
}

// createVendor inserts an owned vendor.
func createVendor(t *testing.T, active bool) int64 {
	t.Helper()
	var id int64
	err := testutil.Pool(t).QueryRow(context.Background(), `
		INSERT INTO vendors (name, is_active, created_by, updated_by)
		VALUES ($1, $2, $3, $3) RETURNING id`,
		fmt.Sprintf("Vendor Uji %d", time.Now().UnixNano()), active, seedUserID,
	).Scan(&id)
	require.NoError(t, err)
	testutil.NewCleaner(t).Vendor(id)
	return id
}

func setVendorActive(t *testing.T, id int64, active bool) {
	t.Helper()
	_, err := testutil.Pool(t).Exec(context.Background(),
		`UPDATE vendors SET is_active = $2 WHERE id = $1`, id, active)
	require.NoError(t, err)
}

func matchRows(t *testing.T, req items.MatchRowsRequest) items.MatchRowsResponse {
	t.Helper()
	res := doJSON(t, newSrv(t), http.MethodPost, "/items/match-rows", req)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var out items.MatchRowsResponse
	require.NoError(t, json.NewDecoder(res.Body).Decode(&out))
	for _, row := range out.Rows {
		if row.Matched != nil && row.Source == "CREATED" {
			testutil.NewCleaner(t).Item(row.Matched.ItemID)
		}
	}
	return out
}

// IMPA codes are normalized.
// They are upper-cased and trimmed (MD-03).
func TestHandler_IMPA_NormalisedOnWrite(t *testing.T) {
	code := uniqueIMPA()
	it := createItem(t, items.CreateItemRequest{Name: uniqueItemName("IMPA"), IMPACode: ptrS("  " + code + " ")})
	require.NotNil(t, it.IMPACode)
	assert.Equal(t, strings.ToUpper(code), *it.IMPACode)

	other := uniqueIMPA()
	res := doJSON(t, newSrv(t), http.MethodPut, "/items/"+itoa(it.ID), items.UpdateItemRequest{
		Name: it.Name, IMPACode: ptrS(other), IsActive: true,
	})
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var upd items.Item
	require.NoError(t, json.NewDecoder(res.Body).Decode(&upd))
	require.NotNil(t, upd.IMPACode)
	assert.Equal(t, strings.ToUpper(other), *upd.IMPACode)

	blank := createItem(t, items.CreateItemRequest{Name: uniqueItemName("IMPA"), IMPACode: ptrS("   ")})
	assert.Nil(t, blank.IMPACode, "a blank code is no code")
}

// Import matches IMPA case-insensitively.
// It covers MD-03.
func TestHandler_MatchRows_IMPAIgnoresCase(t *testing.T) {
	code := uniqueIMPA()
	it := createItem(t, items.CreateItemRequest{Name: uniqueItemName("IMPA"), IMPACode: ptrS(code)})

	// A row stored before normalisation must still match.
	legacyCode := uniqueIMPA()
	legacy := createItem(t, items.CreateItemRequest{Name: uniqueItemName("LEGACY")})
	_, err := testutil.Pool(t).Exec(context.Background(),
		`UPDATE items SET impa_code = $2 WHERE id = $1`, legacy.ID, legacyCode)
	require.NoError(t, err)

	cases := []struct {
		name  string
		query string
		want  int64
	}{
		{"lowercase query", code, it.ID},
		{"uppercase query", strings.ToUpper(code), it.ID},
		{"padded query", "  " + code + "  ", it.ID},
		{"lowercase stored row", strings.ToUpper(legacyCode), legacy.ID},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			out := matchRows(t, items.MatchRowsRequest{
				AutoCreate: true,
				Rows:       []items.MatchRowInput{{IMPACode: c.query, Name: uniqueItemName("NOPE"), Qty: 1}},
			})
			require.Len(t, out.Rows, 1)
			require.NotNil(t, out.Rows[0].Matched)
			assert.Equal(t, "IMPA_EXACT", out.Rows[0].Source)
			assert.Equal(t, c.want, out.Rows[0].Matched.ItemID)
		})
	}
}

// One active item per IMPA.
// It covers MD-04.
func TestHandler_IMPA_DuplicateActiveIsConflict(t *testing.T) {
	code := uniqueIMPA()
	createItem(t, items.CreateItemRequest{Name: uniqueItemName("OWNER"), IMPACode: ptrS(code)})
	other := createItem(t, items.CreateItemRequest{Name: uniqueItemName("OTHER")})

	create := doJSON(t, newSrv(t), http.MethodPost, "/items/",
		items.CreateItemRequest{Name: uniqueItemName("DUP"), IMPACode: ptrS(strings.ToUpper(code))})
	defer create.Body.Close()
	if create.StatusCode == http.StatusCreated {
		var leaked items.Item
		_ = json.NewDecoder(create.Body).Decode(&leaked)
		testutil.NewCleaner(t).Item(leaked.ID)
	}
	assert.Equal(t, http.StatusConflict, create.StatusCode, "create with a taken code")

	upd := doJSON(t, newSrv(t), http.MethodPut, "/items/"+itoa(other.ID),
		items.UpdateItemRequest{Name: other.Name, IMPACode: ptrS(code), IsActive: true})
	defer upd.Body.Close()
	assert.Equal(t, http.StatusConflict, upd.StatusCode, "update onto a taken code")

	inactive := false
	retired := createItem(t, items.CreateItemRequest{
		Name: uniqueItemName("RETIRED"), IMPACode: ptrS(code), IsActive: &inactive,
	})
	assert.False(t, retired.IsActive, "an inactive item may keep a code an active one owns")
}

// Deactivated vendor prices never attach.
// It covers MD-01.
func TestHandler_MatchRows_SkipsDeactivatedVendorPrice(t *testing.T) {
	code := uniqueIMPA()
	it := createItem(t, items.CreateItemRequest{Name: uniqueItemName("PRICED"), IMPACode: ptrS(code)})
	cheap := createVendor(t, true)
	dear := createVendor(t, true)
	for _, link := range []struct {
		vendor int64
		cost   string
	}{{cheap, "100"}, {dear, "200"}} {
		res := doJSON(t, newSrv(t), http.MethodPost, "/items/"+itoa(it.ID)+"/vendors",
			items.AddVendorToItemRequest{VendorID: link.vendor, CostPrice: ptrS(link.cost)})
		res.Body.Close()
		require.Equal(t, http.StatusCreated, res.StatusCode)
	}
	setVendorActive(t, cheap, false)

	row := items.MatchRowInput{IMPACode: code, Name: it.Name, Qty: 1}
	out := matchRows(t, items.MatchRowsRequest{Rows: []items.MatchRowInput{row}})
	require.Len(t, out.Rows, 1)
	m := out.Rows[0].Matched
	require.NotNil(t, m)
	require.NotNil(t, m.VendorID, "the active vendor's price should be attached")
	assert.Equal(t, dear, *m.VendorID)
	require.NotNil(t, m.CostPrice)
	assert.Equal(t, "200.00", *m.CostPrice)

	setVendorActive(t, dear, false)
	out = matchRows(t, items.MatchRowsRequest{Rows: []items.MatchRowInput{row}})
	m = out.Rows[0].Matched
	require.NotNil(t, m)
	assert.Nil(t, m.VendorProductID, "no active vendor leaves the price empty")
	assert.Nil(t, m.CostPrice)
}

// Linking needs active vendors.
// It covers MD-11.
func TestHandler_AddVendor_RequiresActiveVendor(t *testing.T) {
	it := createItem(t, items.CreateItemRequest{Name: uniqueItemName("LINK")})
	cases := []struct {
		name   string
		vendor int64
		want   int
	}{
		{"active vendor links", createVendor(t, true), http.StatusCreated},
		{"inactive vendor is refused", createVendor(t, false), http.StatusUnprocessableEntity},
		{"missing vendor is not found", 999_999_999, http.StatusNotFound},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := doJSON(t, newSrv(t), http.MethodPost, "/items/"+itoa(it.ID)+"/vendors",
				items.AddVendorToItemRequest{VendorID: c.vendor, CostPrice: ptrS("150")})
			defer res.Body.Close()
			assert.Equal(t, c.want, res.StatusCode)
		})
	}
}
