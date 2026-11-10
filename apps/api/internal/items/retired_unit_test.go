package items_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const retiredOTH = "Satuan OTH sudah tidak dipakai. Pilih satuan lain."

// unitByCode reads a unit id.
func unitByCode(t *testing.T, code string) int16 {
	t.Helper()
	var id int16
	require.NoError(t, testutil.Pool(t).QueryRow(context.Background(),
		`SELECT id FROM units WHERE code = $1`, code).Scan(&id))
	return id
}

// A retired default is refused.
// A product keeps OTH it already has, but neither a new product nor a
// changed one picks it.
func TestHandler_RetiredDefaultUnit(t *testing.T) {
	oth, pcs := unitByCode(t, "OTH"), unitByCode(t, "PCS")
	kept := createItem(t, items.CreateItemRequest{Name: uniqueItemName("SATUAN LAMA"), DefaultUnitID: &pcs})
	_, err := testutil.Pool(t).Exec(context.Background(),
		`UPDATE items SET default_unit_id = $1 WHERE id = $2`, oth, kept.ID)
	require.NoError(t, err)
	moved := createItem(t, items.CreateItemRequest{Name: uniqueItemName("SATUAN BARU"), DefaultUnitID: &pcs})

	cases := []struct {
		name   string
		method string
		path   string
		body   any
		status int
	}{
		{"create", http.MethodPost, "/items/",
			items.CreateItemRequest{Name: uniqueItemName("SATUAN OTH"), DefaultUnitID: &oth}, http.StatusUnprocessableEntity},
		{"switch to it", http.MethodPut, fmt.Sprintf("/items/%d", moved.ID),
			items.UpdateItemRequest{Name: moved.Name, DefaultUnitID: &oth, IsActive: true}, http.StatusUnprocessableEntity},
		{"keep it", http.MethodPut, fmt.Sprintf("/items/%d", kept.ID),
			items.UpdateItemRequest{Name: kept.Name + " X", DefaultUnitID: &oth, IsActive: true}, http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res := doJSON(t, newSrv(t), tc.method, tc.path, tc.body)
			defer res.Body.Close()
			require.Equal(t, tc.status, res.StatusCode)
			if tc.status != http.StatusUnprocessableEntity {
				return
			}
			var p struct {
				Fields map[string]string `json:"fields"`
			}
			require.NoError(t, json.NewDecoder(res.Body).Decode(&p))
			assert.Equal(t, map[string]string{"defaultUnitId": retiredOTH}, p.Fields)
		})
	}
}
