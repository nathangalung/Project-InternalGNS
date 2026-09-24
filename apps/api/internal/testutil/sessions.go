package testutil

import (
	"context"
	"fmt"

	dbmig "github.com/nathangalung/internalgns/apps/api/internal/shared/db"
)

// PredateSessions backdates a session epoch.
//
// The auth middleware refuses a token whose iat precedes the account's
// sessions_valid_from. Postgres stamps the epoch and the test mints the iat,
// both from the wall clock, and the WSL2 dev host steps that clock back
// about 2.5s every half minute. A token minted in the seconds after such a
// step can then read as older than an account created just before it, and
// the middleware answers 401 instead of the status under test. Call this
// right after creating an account whose epoch is not what the test is about.
// It returns an error rather than failing t so godog steps can call it.
func PredateSessions(ctx context.Context, exec dbmig.Executor, userID int64) error {
	tag, err := exec.Exec(ctx,
		`UPDATE users SET sessions_valid_from = sessions_valid_from - interval '1 hour'
		  WHERE id = $1`, userID)
	if err != nil {
		return fmt.Errorf("predate sessions of user %d: %w", userID, err)
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("predate sessions of user %d: %d rows", userID, tag.RowsAffected())
	}
	return nil
}
