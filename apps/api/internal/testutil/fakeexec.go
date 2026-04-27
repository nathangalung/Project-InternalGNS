package testutil

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ErrFake is the canned error.
var ErrFake = errors.New("fake exec failure")

// FakeExec always errors.
type FakeExec struct{}

func (FakeExec) Query(_ context.Context, _ string, _ ...any) (pgx.Rows, error) {
	return nil, ErrFake
}

func (FakeExec) QueryRow(_ context.Context, _ string, _ ...any) pgx.Row {
	return fakeRow{}
}

func (FakeExec) Exec(_ context.Context, _ string, _ ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, ErrFake
}

type fakeRow struct{}

func (fakeRow) Scan(_ ...any) error { return ErrFake }

// CountingExec wraps inner exec, fails after N calls.
type CountingExec struct {
	Inner    interface {
		Query(context.Context, string, ...any) (pgx.Rows, error)
		QueryRow(context.Context, string, ...any) pgx.Row
		Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	}
	FailAfter int
	calls     int
}

func (c *CountingExec) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	c.calls++
	if c.calls > c.FailAfter {
		return nil, ErrFake
	}
	return c.Inner.Query(ctx, sql, args...)
}

func (c *CountingExec) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	c.calls++
	if c.calls > c.FailAfter {
		return fakeRow{}
	}
	return c.Inner.QueryRow(ctx, sql, args...)
}

func (c *CountingExec) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	c.calls++
	if c.calls > c.FailAfter {
		return pgconn.CommandTag{}, ErrFake
	}
	return c.Inner.Exec(ctx, sql, args...)
}
