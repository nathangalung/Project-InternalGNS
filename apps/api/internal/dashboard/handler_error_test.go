package dashboard_test

import (
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/dashboard"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

func TestHandler_ErrorPaths(t *testing.T) {
	srv := testutil.FaultyServer(t, 1, func(r chi.Router, d deps.Deps) {
		r.Mount("/dashboard", dashboard.Routes(d))
	})

	t.Run("summary", func(t *testing.T) {
		res, err := srv.Client().Get(srv.URL + "/dashboard/summary")
		require.NoError(t, err)
		defer res.Body.Close()
		assert.Equal(t, http.StatusInternalServerError, res.StatusCode)
	})
	t.Run("timeseries", func(t *testing.T) {
		res, err := srv.Client().Get(srv.URL + "/dashboard/timeseries?metric=quotation")
		require.NoError(t, err)
		defer res.Body.Close()
		assert.Equal(t, http.StatusInternalServerError, res.StatusCode)
	})
}
