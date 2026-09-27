package invoices

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Named response keeps map bytes.
func TestDatesUpdatedResponse_MatchesLegacyMap(t *testing.T) {
	got, err := json.Marshal(DatesUpdatedResponse{RowVersion: 5})
	require.NoError(t, err)
	want, err := json.Marshal(map[string]int32{"rowVersion": 5})
	require.NoError(t, err)
	assert.Equal(t, string(want), string(got))
}
