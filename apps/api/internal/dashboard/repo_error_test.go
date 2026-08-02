package dashboard_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/nathangalung/internalgns/apps/api/internal/dashboard"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

func TestRepo_ErrorPaths(t *testing.T) {
	r := dashboard.NewRepo(testutil.FakeExec{}, testutil.Store(t))
	ctx := context.Background()

	_, err := r.Summary(ctx)
	assert.ErrorIs(t, err, testutil.ErrFake)

	from := time.Now().AddDate(0, -3, 0)
	to := time.Now()
	_, err = r.Timeseries(ctx, "quotation", from, to, "month")
	assert.ErrorIs(t, err, testutil.ErrFake)
}
