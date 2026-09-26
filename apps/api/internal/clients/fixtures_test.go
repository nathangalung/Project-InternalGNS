package clients_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// freeNumbers picks unused client numbers.
// company_client.number is a unique four digit key (migration 00052), so a
// literal would collide with whatever an earlier run committed.
func freeNumbers(t testing.TB, exec db.Executor, n int) []string {
	t.Helper()
	var out []string
	err := exec.QueryRow(context.Background(), `
		SELECT COALESCE(array_agg(num), '{}') FROM (
		  SELECT LPAD(g::text, 4, '0') AS num
		  FROM generate_series(1, 9999) AS g
		  WHERE NOT EXISTS (
		    SELECT 1 FROM company_client WHERE number = LPAD(g::text, 4, '0'))
		  ORDER BY random()
		  LIMIT $1
		) free`, n).Scan(&out)
	require.NoError(t, err)
	require.Len(t, out, n, "no free client numbers left")
	return out
}

// freeNumber picks an unused number.
func freeNumber(t testing.TB, exec db.Executor) *string {
	t.Helper()
	return &freeNumbers(t, exec, 1)[0]
}

// newClient inserts an owned client.
// Contacts hang off it, so the Cleaner removes them with the client instead
// of leaving them on a shared master row.
func newClient(t testing.TB) int64 {
	t.Helper()
	pool := testutil.Pool(t)
	var id int64
	err := pool.QueryRow(context.Background(), `
		INSERT INTO company_client (number, name, country_code, created_by, updated_by)
		VALUES ($1, $2, 'IDN', $3, $3) RETURNING id`,
		*freeNumber(t, pool), fmt.Sprintf("PT Fixture %d", time.Now().UnixNano()), seedUserID,
	).Scan(&id)
	require.NoError(t, err)
	testutil.NewCleaner(t).Client(id)
	return id
}
