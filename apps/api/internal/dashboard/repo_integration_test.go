package dashboard_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/dashboard"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

func TestRepo_Summary(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := dashboard.NewRepo(tx, testutil.Store(t))

	s, err := repo.Summary(ctx)
	require.NoError(t, err)
	assert.NotNil(t, s)
}

func TestRepo_Timeseries_AllMetrics(t *testing.T) {
	from := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	metrics := []string{"quotation", "invoice", "revenue", "profit", "ppn"}

	for _, m := range metrics {
		t.Run(m, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			repo := dashboard.NewRepo(tx, testutil.Store(t))
			points, err := repo.Timeseries(ctx, m, from, to)
			require.NoError(t, err)
			_ = points
		})
	}
}

func TestRepo_Timeseries_UnknownMetric(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := dashboard.NewRepo(tx, testutil.Store(t))

	from := time.Now().AddDate(0, -1, 0)
	to := time.Now()
	_, err := repo.Timeseries(ctx, "nonsense", from, to)
	assert.ErrorIs(t, err, dashboard.ErrUnknownMetric)
}
