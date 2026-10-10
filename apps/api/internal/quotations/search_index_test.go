package quotations_test

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// countRecorder keeps the count statement.
type countRecorder struct {
	pgx.Tx
	sql  string
	args []any
}

func (c *countRecorder) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	if c.sql == "" {
		c.sql, c.args = sql, args
	}
	return c.Tx.QueryRow(ctx, sql, args...)
}

// List search stays indexable.
// Every OR arm of the search needs a trigram index, or the planner cannot
// combine bitmaps and scans the whole table. With sequential scans priced
// out, the list's own count statement must answer from the indexes alone.
func TestRepo_List_SearchUsesTrigramIndexes(t *testing.T) {
	cases := []struct {
		name string
		q    string
		want []string
	}{
		{"text", "kapal", []string{
			"idx_quotations_client_name_trgm", "idx_quotations_no_trgm", "idx_quotations_legacy_no_trgm",
		}},
		{"period", "X/2026", []string{"idx_quotations_client_name_trgm", "idx_quotations_no_trgm"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			rec := &countRecorder{Tx: tx}
			_, err := quotations.NewRepo(rec, testutil.Store(t)).List(ctx, quotations.ListFilter{Q: c.q, Limit: 10})
			require.NoError(t, err)
			require.NotEmpty(t, rec.sql)

			_, err = tx.Exec(ctx, "SET LOCAL enable_seqscan = off")
			require.NoError(t, err)
			rows, err := tx.Query(ctx, "EXPLAIN "+rec.sql, rec.args...)
			require.NoError(t, err)
			lines, err := pgx.CollectRows(rows, pgx.RowTo[string])
			require.NoError(t, err)
			plan := strings.Join(lines, "\n")

			assert.NotContains(t, plan, "Seq Scan", plan)
			for _, idx := range c.want {
				assert.Contains(t, plan, idx, plan)
			}
		})
	}
}
