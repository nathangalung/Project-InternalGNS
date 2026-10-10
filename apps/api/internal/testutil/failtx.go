package testutil

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
)

// TxExec runs statements and transactions.
// Satisfied by *pgxpool.Pool and pgx.Tx.
type TxExec interface {
	db.Executor
	db.TxBeginner
}

// FailAtTx fails one transaction statement.
// Begin opens a real transaction (a savepoint under a pgx.Tx) whose FailAt-th
// statement, counted from 1, returns ErrFake, so each step of a repo method
// that runs in a transaction reaches its error path. Statements outside the
// transaction pass through.
type FailAtTx struct {
	Inner  TxExec
	FailAt int
}

func (f FailAtTx) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	return f.Inner.Query(ctx, sql, args...)
}

func (f FailAtTx) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return f.Inner.QueryRow(ctx, sql, args...)
}

func (f FailAtTx) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	return f.Inner.Exec(ctx, sql, args...)
}

func (f FailAtTx) Begin(ctx context.Context) (pgx.Tx, error) {
	tx, err := f.Inner.Begin(ctx)
	if err != nil {
		return nil, err
	}
	return &failingTx{Tx: tx, failAt: f.FailAt}, nil
}

// failingTx counts its statements.
type failingTx struct {
	pgx.Tx
	failAt int
	n      int
}

func (t *failingTx) fails() bool {
	t.n++
	return t.n == t.failAt
}

func (t *failingTx) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	if t.fails() {
		return nil, ErrFake
	}
	return t.Tx.Query(ctx, sql, args...)
}

func (t *failingTx) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	if t.fails() {
		return fakeRow{}
	}
	return t.Tx.QueryRow(ctx, sql, args...)
}

func (t *failingTx) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	if t.fails() {
		return pgconn.CommandTag{}, ErrFake
	}
	return t.Tx.Exec(ctx, sql, args...)
}

// FailBegin executes but cannot begin.
// Every call fails, Begin included, for the error before any statement.
type FailBegin struct {
	FakeExec
	FakeBeginner
}
