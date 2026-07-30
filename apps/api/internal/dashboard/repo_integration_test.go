package dashboard_test

import (
	"regexp"
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
	// Wide range catches any seeded rows for the shape check.
	from := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC)
	metrics := []string{"quotation", "invoice", "revenue", "profit", "ppn"}
	shape := map[string]*regexp.Regexp{
		"month": regexp.MustCompile(`^\d{4}-\d{2}$`),
		"day":   regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`),
	}

	for _, m := range metrics {
		for _, interval := range []string{"month", "day"} {
			t.Run(m+"/"+interval, func(t *testing.T) {
				ctx, tx := testutil.BeginTx(t)
				repo := dashboard.NewRepo(tx, testutil.Store(t))
				// A 3-arg call proves the $3::text binding on live pg.
				points, err := repo.Timeseries(ctx, m, from, to, interval)
				require.NoError(t, err)
				for _, p := range points {
					assert.Regexp(t, shape[interval], p.Month, "%s %s bucket", m, interval)
				}
				if len(points) > 0 {
					t.Logf("%s/%s first bucket: %s", m, interval, points[0].Month)
				}
			})
		}
	}
}

func TestRepo_Timeseries_UnknownMetric(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := dashboard.NewRepo(tx, testutil.Store(t))

	from := time.Now().AddDate(0, -1, 0)
	to := time.Now()
	_, err := repo.Timeseries(ctx, "nonsense", from, to, "month")
	assert.ErrorIs(t, err, dashboard.ErrUnknownMetric)
}
