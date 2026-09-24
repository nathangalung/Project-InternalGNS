package purchaseorders_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// brokenRows fails while reading, as a dropped connection does.
// Postgres can accept a query and fail it only after the first rows,
// so the error arrives from rows.Err rather than from Query.
type brokenRows struct{}

func (brokenRows) Close()                                       {}
func (brokenRows) Err() error                                   { return testutil.ErrFake }
func (brokenRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (brokenRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (brokenRows) Next() bool                                   { return false }
func (brokenRows) Scan(...any) error                            { return testutil.ErrFake }
func (brokenRows) Values() ([]any, error)                       { return nil, testutil.ErrFake }
func (brokenRows) RawValues() [][]byte                          { return nil }
func (brokenRows) Conn() *pgx.Conn                              { return nil }

// breakQuery runs every query but the nth, which reads as broken.
type breakQuery struct {
	db.Executor
	nth   int
	count int
}

func (b *breakQuery) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	b.count++
	if b.count == b.nth {
		return brokenRows{}, nil
	}
	return b.Executor.Query(ctx, sql, args...)
}

// A read that breaks mid-result surfaces, never a short answer.
func TestRepo_BrokenResultSets(t *testing.T) {
	tests := []struct {
		name string
		nth  int
		run  func(repo *purchaseorders.Repo, poID int64) error
		want string
	}{
		{"list rows", 1, func(repo *purchaseorders.Repo, _ int64) error {
			_, err := repo.List(context.Background(), purchaseorders.ListFilter{Limit: 1})
			return err
		}, ""},
		{"history", 1, func(repo *purchaseorders.Repo, poID int64) error {
			_, err := repo.History(context.Background(), poID)
			return err
		}, "scan po history"},
		{"client completeness", 1, func(repo *purchaseorders.Repo, poID int64) error {
			_, err := repo.Completeness(context.Background(), poID)
			return err
		}, "scan client completeness"},
		{"vendor completeness", 2, func(repo *purchaseorders.Repo, poID int64) error {
			_, err := repo.Completeness(context.Background(), poID)
			return err
		}, "scan vendor completeness"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, tx := testutil.BeginTx(t)
			_, poID := acceptedQuotationWithPO(t, tx)
			repo := purchaseorders.NewRepo(&breakQuery{Executor: tx, nth: tc.nth}, testutil.Store(t))
			err := tc.run(repo, poID)
			require.ErrorIs(t, err, testutil.ErrFake)
			if tc.want != "" {
				assert.ErrorContains(t, err, tc.want)
			}
		})
	}
}
