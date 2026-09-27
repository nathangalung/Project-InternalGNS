package purchaseorders

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Named response keeps map bytes.
func TestUpdatedResponse_MatchesLegacyMap(t *testing.T) {
	got, err := json.Marshal(UpdatedResponse{ID: 9, RowVersion: 4})
	require.NoError(t, err)
	want, err := json.Marshal(map[string]any{"id": int64(9), "rowVersion": int32(4)})
	require.NoError(t, err)
	assert.Equal(t, string(want), string(got))
}
