package clients_test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/tz"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// KPI buckets follow WIB boundaries.
//
// The rows sit on the instants the buckets turn over, so a summary that
// cut months or years in UTC would move them into the wrong bucket.
func TestRepo_Summary_CountsByWIBBoundary(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := clients.NewRepo(tx, testutil.Store(t))

	now := tz.Now()
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, tz.Jakarta())
	yearStart := time.Date(now.Year(), 1, 1, 0, 0, 0, 0, tz.Jakarta())
	beforeMonth := monthStart.Add(-time.Second)

	before, err := repo.Summary(ctx)
	require.NoError(t, err)

	numbers := freeNumbers(t, tx, 4)
	rows := []struct {
		createdAt time.Time
		active    bool
	}{
		{monthStart, true},
		{beforeMonth, true},
		{yearStart.Add(-time.Second), true},
		{now, false},
	}
	for i, r := range rows {
		insertClientAt(t, ctx, tx, numbers[i], r.createdAt, r.active)
	}

	after, err := repo.Summary(ctx)
	require.NoError(t, err)

	// The second before this month is last year only in January.
	lastYear := int64(1)
	if beforeMonth.Year() < now.Year() {
		lastYear = 2
	}
	assert.Equal(t, int64(4), after.Total-before.Total, "total")
	assert.Equal(t, int64(3), after.ActiveCount-before.ActiveCount, "active")
	assert.Equal(t, int64(2), after.NewThisMonth-before.NewThisMonth, "month start and now")
	assert.Equal(t, 4-lastYear, after.NewThisYear-before.NewThisYear, "this year")
	assert.Equal(t, lastYear, after.PrevYearTotal-before.PrevYearTotal, "before this year")
}

func insertClientAt(t *testing.T, ctx context.Context, tx pgx.Tx, number string, at time.Time, active bool) {
	t.Helper()
	_, err := tx.Exec(ctx, `
		INSERT INTO company_client (number, name, country_code, is_active, created_at, created_by, updated_by)
		VALUES ($1, 'PT Batas Waktu', 'IDN', $2, $3, $4, $4)`, number, active, at, seedUserID)
	require.NoError(t, err)
}

// The endpoint serves the same aggregates.
func TestHandler_Summary_MatchesRepo(t *testing.T) {
	res := doJSON(t, newSrv(t), http.MethodGet, "/clients/summary", nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	want, err := clients.NewRepo(testutil.Pool(t), testutil.Store(t)).Summary(context.Background())
	require.NoError(t, err)
	var got clients.Summary
	require.NoError(t, json.NewDecoder(res.Body).Decode(&got))
	assert.Equal(t, want, got)
}
