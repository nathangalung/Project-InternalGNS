package units_test

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

func TestHandler_List(t *testing.T) {
	srv := testutil.UnitsServer(t)

	res, err := srv.Client().Get(srv.URL + "/units/")
	require.NoError(t, err)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	assert.Equal(t, "application/json", res.Header.Get("Content-Type"))
	// A list endpoint reports its size like every other list.
	total := res.Header.Get("X-Total-Count")

	var got []map[string]any
	require.NoError(t, json.NewDecoder(res.Body).Decode(&got))
	assert.Equal(t, strconv.Itoa(len(got)), total)
	assert.GreaterOrEqual(t, len(got), 33)
	// Every unit carries its aliases, an empty list included.
	for _, u := range got {
		aliases, ok := u["aliases"].([]any)
		require.True(t, ok, "unit %v has an aliases list", u["code"])
		if u["code"] == "PCS" {
			assert.Contains(t, aliases, "PIECES")
		}
	}
}
