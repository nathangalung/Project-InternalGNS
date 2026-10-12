package validate_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/validate"
)

// A client pick names ids.
func TestClientChoice(t *testing.T) {
	ids := func(v int64) *int64 { return &v }
	cases := []struct {
		name    string
		client  int64
		contact *int64
		want    map[string]string
	}{
		{"client alone", 4, nil, nil},
		{"client and contact", 4, ids(7), nil},
		{"no client", 0, nil, map[string]string{"clientId": validate.ClientPickMessage}},
		{"negative client", -1, nil, map[string]string{"clientId": validate.ClientPickMessage}},
		{"zero contact", 4, ids(0), map[string]string{"contactId": validate.ContactPickMessage}},
		{"both wrong", 0, ids(-2), map[string]string{
			"clientId": validate.ClientPickMessage, "contactId": validate.ContactPickMessage,
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, validate.ClientChoice(tc.client, tc.contact))
		})
	}
}
