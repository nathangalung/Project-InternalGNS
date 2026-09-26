-- +goose Up

-- Access tokens are stateless, so a password reset could not end a live
-- session before this column existed. The auth middleware refuses any token
-- issued before it. Truncated to the second because the JWT iat claim is
-- second-granular: an untruncated default would refuse the token minted in
-- the same second the account was created.
ALTER TABLE users
  ADD COLUMN sessions_valid_from TIMESTAMPTZ NOT NULL
    DEFAULT date_trunc('second', now());

COMMENT ON COLUMN users.sessions_valid_from IS
  'Access tokens issued before this instant are refused. Bumped on password change.';

-- Refresh reuse detection could not tell an admin revocation from a replay,
-- so revoking one session killed every other one the user had.
ALTER TABLE refresh_tokens
  ADD COLUMN revoked_reason TEXT;

COMMENT ON COLUMN refresh_tokens.revoked_reason IS
  'Why the token was revoked: rotated, logout, admin, reuse. NULL on legacy rows.';

UPDATE refresh_tokens
   SET revoked_reason = 'rotated'
 WHERE revoked_at IS NOT NULL AND revoked_reason IS NULL;

-- Hard 15-minute lockouts are replaced by an escalating per-attempt delay,
-- so no account stays locked out of a login it can pass.
UPDATE users
   SET locked_until = NULL
 WHERE locked_until IS NOT NULL;

-- +goose Down
ALTER TABLE refresh_tokens DROP COLUMN revoked_reason;
ALTER TABLE users DROP COLUMN sessions_valid_from;
