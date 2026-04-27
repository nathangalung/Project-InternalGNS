package units_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/units"
)

func TestHandler_List(t *testing.T) {
	srv := testutil.UnitsServer(t)

	res, err := srv.Client().Get(srv.URL + "/units/")
	require.NoError(t, err)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	assert.Equal(t, "application/json", res.Header.Get("Content-Type"))

	var got []units.Unit
	require.NoError(t, json.NewDecoder(res.Body).Decode(&got))
	assert.GreaterOrEqual(t, len(got), 33)
}
