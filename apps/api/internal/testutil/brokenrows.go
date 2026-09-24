package testutil

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// BrokenStreamExec breaks a result stream.
// The first Skip Query calls reach Inner; later ones return rows that fail
// the way a dropped connection does: after RowsBefore rows whose Scan
// fails, or at the end through Err when RowsBefore is 0. QueryRow and
// Exec always reach Inner.
type BrokenStreamExec struct {
	Inner interface {
		Query(context.Context, string, ...any) (pgx.Rows, error)
		QueryRow(context.Context, string, ...any) pgx.Row
		Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	}
	Skip       int
	RowsBefore int
	queries    int
}

func (b *BrokenStreamExec) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	b.queries++
	if b.queries <= b.Skip {
		return b.Inner.Query(ctx, sql, args...)
	}
	return &brokenRows{left: b.RowsBefore}, nil
}

func (b *BrokenStreamExec) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return b.Inner.QueryRow(ctx, sql, args...)
}

func (b *BrokenStreamExec) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	return b.Inner.Exec(ctx, sql, args...)
}

// brokenRows fails mid-stream.
type brokenRows struct {
	left int
}

func (r *brokenRows) Close()                                       {}
func (r *brokenRows) Err() error                                   { return ErrFake }
func (r *brokenRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *brokenRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *brokenRows) Scan(_ ...any) error                          { return ErrFake }
func (r *brokenRows) Values() ([]any, error)                       { return nil, ErrFake }
func (r *brokenRows) RawValues() [][]byte                          { return nil }
func (r *brokenRows) Conn() *pgx.Conn                              { return nil }

func (r *brokenRows) Next() bool {
	if r.left == 0 {
		return false
	}
	r.left--
	return true
}
