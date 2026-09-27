package purchaseorders

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestChargeWithoutAddress(t *testing.T) {
	cases := []struct {
		name    string
		address *string
		cost    *string
		want    bool
	}{
		{"no cost", nil, nil, false},
		{"zero cost", nil, s("0"), false},
		{"unparseable cost is left to the database", nil, s("abc"), false},
		{"cost without address", nil, s(" 75000 "), true},
		{"cost with blank address", s("  "), s("75000"), true},
		{"cost with address", s("Dermaga 3"), s("75000"), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := UpdateItemsRequest{ShippingAddress: tc.address, ShippingCost: tc.cost}
			assert.Equal(t, tc.want, chargeWithoutAddress(req))
		})
	}
}
