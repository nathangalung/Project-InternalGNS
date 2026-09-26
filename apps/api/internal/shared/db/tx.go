package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// TxBeginner opens a transaction.
// Satisfied by *pgxpool.Pool and by pgx.Tx (nested savepoint).
type TxBeginner interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

// WithTx runs fn transactionally.
// fn's own error is returned unwrapped so callers can match sentinels.
func WithTx(ctx context.Context, b TxBeginner, fn func(pgx.Tx) error) error {
	tx, err := b.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}
