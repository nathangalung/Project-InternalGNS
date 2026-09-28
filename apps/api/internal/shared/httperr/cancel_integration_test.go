package httperr_test

import (
	"context"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// A cancelled query is 499.
// pgx wraps the cancel, so the check must see through its error.
func TestRenderDBErrCtx_CancelledQuery(t *testing.T) {
	pool := testutil.Pool(t)
	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(50*time.Millisecond, cancel)
	_, err := pool.Exec(ctx, "SELECT pg_sleep(5)")
	require.Error(t, err)

	rec := httptest.NewRecorder()
	httperr.RenderDBErrCtx(ctx, rec, err)
	assert.Equal(t, httperr.StatusClientClosedRequest, rec.Code)
}
