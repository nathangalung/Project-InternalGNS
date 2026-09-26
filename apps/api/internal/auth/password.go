package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"golang.org/x/crypto/bcrypt"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

// ErrWrongCurrentPassword refuses a self-service change.
var ErrWrongCurrentPassword = errors.New("current password is wrong")

// A newer change overtook verification.
var ErrPasswordChanged = errors.New("password changed since it was verified")

// ChangeOwnPassword replaces the caller's password.
// It re-checks the current one first, then ends every session, the caller's
// included. The check shares the login attempt counter and backoff: an
// access token alone must not buy an unthrottled password oracle.
func (s *Service) ChangeOwnPassword(ctx context.Context, userID int64, current, next string) error {
	u, err := s.users.GetByID(ctx, userID)
	if errors.Is(err, users.ErrNotFound) {
		return ErrSessionRevoked
	}
	if err != nil {
		return fmt.Errorf("change own password: %w", err)
	}

	lock, err := s.users.LockStatus(ctx, u.Email)
	if errors.Is(err, users.ErrNotFound) {
		return ErrSessionRevoked
	}
	if err != nil {
		return fmt.Errorf("change own password: %w", err)
	}
	throttle(ctx, loginBackoff(lock.FailedLoginAttempts))

	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(current)); err != nil {
		if rerr := s.users.RecordFailedLogin(ctx, u.Email); rerr != nil {
			slog.ErrorContext(ctx, "record failed password check", "error", rerr, "user_id", u.ID)
		}
		return ErrWrongCurrentPassword
	}

	// Claim the verified hash, then write, in one transaction. The claim
	// row-locks the account, so a reset that landed first fails the claim and
	// one that lands later waits and then replaces this change. The new hash
	// is computed under that lock, which costs a reset one bcrypt of waiting.
	err = s.users.InTx(ctx, func(q *users.Repo, _ db.Executor) error {
		if _, err := q.ClaimLogin(ctx, u.ID, u.PasswordHash); err != nil {
			return err
		}
		return q.UpdatePassword(ctx, userID, next, userID)
	})
	if errors.Is(err, users.ErrNotFound) {
		return s.claimFailure(ctx, userID)
	}
	if err != nil {
		return fmt.Errorf("change own password: %w", err)
	}
	return nil
}

// Changed password or closed account.
func (s *Service) claimFailure(ctx context.Context, userID int64) error {
	_, err := s.users.GetByID(ctx, userID)
	if errors.Is(err, users.ErrNotFound) {
		return ErrSessionRevoked
	}
	if err != nil {
		return fmt.Errorf("change own password: %w", err)
	}
	return ErrPasswordChanged
}
