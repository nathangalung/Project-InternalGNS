package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"golang.org/x/crypto/bcrypt"

	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

// ErrWrongCurrentPassword refuses a self-service change.
var ErrWrongCurrentPassword = errors.New("current password is wrong")

// ChangeOwnPassword replaces the caller's password after re-checking the
// current one, then ends every session, the caller's included. The check
// shares the login attempt counter and backoff: an access token alone must
// not buy an unthrottled password oracle.
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

	// Clears the counter and bumps the session epoch in one transaction.
	if err := s.users.UpdatePassword(ctx, userID, next, userID); err != nil {
		return fmt.Errorf("change own password: %w", err)
	}
	return nil
}
