package countries_test

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/countries"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

func TestHandler_List(t *testing.T) {
	srv := testutil.CountriesServer(t)

	res, err := srv.Client().Get(srv.URL + "/countries/")
	require.NoError(t, err)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	assert.Equal(t, "application/json", res.Header.Get("Content-Type"))
	// A list endpoint reports its size like every other list.
	total := res.Header.Get("X-Total-Count")

	var got []countries.Country
	require.NoError(t, json.NewDecoder(res.Body).Decode(&got))
	assert.Equal(t, strconv.Itoa(len(got)), total)
	assert.GreaterOrEqual(t, len(got), 200)
}
