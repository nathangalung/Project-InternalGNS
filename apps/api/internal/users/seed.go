package users

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

type SeedConfig struct {
	Email    string
	Name     string
	Password string
}

func SeedSuperadmin(ctx context.Context, pool *pgxpool.Pool, cfg SeedConfig) error {
	if cfg.Email == "" || cfg.Password == "" {
		return fmt.Errorf("seed superadmin: email and password required")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(cfg.Password), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("seed superadmin: bcrypt: %w", err)
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Store the address in the same canonical form Repo writes, and infer
	// users_email_lower_idx (00045) rather than users_email_key: a mixed-case
	// SUPERADMIN_EMAIL whose row was since case-folded conflicts only on the
	// expression index, and an uninferred conflict there aborts the boot seed.
	// Targeting an index rather than bare DO NOTHING keeps an unrelated
	// conflict, such as a stale users_id_seq hitting the primary key, loud.
	const insertQ = `
		INSERT INTO users (email, name, password_hash, role, is_active, created_by, updated_by)
		VALUES ($1, $2, $3, 'superadmin', TRUE, NULL, NULL)
		ON CONFLICT (LOWER(email)) DO NOTHING
		RETURNING id`

	var newID int64
	scanErr := tx.QueryRow(ctx, insertQ, normalizeEmail(cfg.Email), cfg.Name, string(hash)).Scan(&newID)
	switch {
	case scanErr == nil:
		const fixFK = `UPDATE users SET created_by = $1, updated_by = $1 WHERE id = $1`
		if _, err := tx.Exec(ctx, fixFK, newID); err != nil {
			return fmt.Errorf("seed superadmin: backfill self-fk: %w", err)
		}
	case errors.Is(scanErr, pgx.ErrNoRows):
	default:
		return fmt.Errorf("seed superadmin: insert: %w", scanErr)
	}

	const syncSeq = `SELECT setval(
		'users_id_seq',
		GREATEST(1, (SELECT COALESCE(MAX(id), 1) FROM users)),
		true
	)`
	if _, err := tx.Exec(ctx, syncSeq); err != nil {
		return fmt.Errorf("seed superadmin: sync sequence: %w", err)
	}

	return tx.Commit(ctx)
}
