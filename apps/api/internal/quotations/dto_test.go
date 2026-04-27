package quotations

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestItemsToJSONB(t *testing.T) {
	items := []CreateItem{
		{
			RequestedName: "BOLT M8",
			Qty:           "5",
			UnitID:        21,
			SellingPrice:  "10000",
		},
		{
			RequestedName:   "PAINT BLACK",
			Qty:             "2",
			UnitID:          37,
			SellingPrice:    "55000",
			VendorProductID: int64Ptr(7),
			ShipDestination: stringPtr("Tanjung Priok"),
		},
	}
	raw, err := itemsToJSONB(items)
	require.NoError(t, err)

	var out []map[string]any
	require.NoError(t, json.Unmarshal(raw, &out))
	require.Len(t, out, 2)
	assert.Equal(t, "BOLT M8", out[0]["requested_name"])
	assert.EqualValues(t, 21, out[0]["unit_id"])
	assert.Equal(t, "PAINT BLACK", out[1]["requested_name"])
	assert.Equal(t, "Tanjung Priok", out[1]["ship_destination"])
	assert.EqualValues(t, 7, out[1]["vendor_product_id"])
}

func TestItemsToJSONB_Empty(t *testing.T) {
	raw, err := itemsToJSONB(nil)
	require.NoError(t, err)
	assert.Equal(t, "[]", string(raw))
}

func int64Ptr(v int64) *int64    { return &v }
func stringPtr(v string) *string { return &v }
