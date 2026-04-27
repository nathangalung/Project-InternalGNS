package countries_test

import (
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/countries"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

func TestHandler_ErrorPath(t *testing.T) {
	srv := testutil.FaultyServer(t, 1, func(r chi.Router, d deps.Deps) {
		r.Mount("/countries", countries.Routes(d))
	})
	res, err := srv.Client().Get(srv.URL + "/countries/")
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusInternalServerError, res.StatusCode)
}
