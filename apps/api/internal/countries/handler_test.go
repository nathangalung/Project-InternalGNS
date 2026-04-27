package countries_test

import (
	"encoding/json"
	"net/http"
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

	var got []countries.Country
	require.NoError(t, json.NewDecoder(res.Body).Decode(&got))
	assert.GreaterOrEqual(t, len(got), 200)
}
