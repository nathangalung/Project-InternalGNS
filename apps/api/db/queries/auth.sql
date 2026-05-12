-- name: auth.refresh_insert
INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
VALUES ($1, $2, $3)
RETURNING id;

-- name: auth.refresh_redeem
-- Atomically revoke an active, non-expired refresh token and return its
-- (id, user_id). 0 rows means it does not exist, is expired, or was already
-- revoked — the caller distinguishes via refresh_lookup.
-- expires_at is compared against clock_timestamp() (real wall-clock at
-- statement time) so a long-running tx cannot resurrect a token that
-- expired mid-transaction.
UPDATE refresh_tokens
SET revoked_at = clock_timestamp()
WHERE token_hash = $1
  AND revoked_at IS NULL
  AND expires_at > clock_timestamp()
RETURNING id, user_id;

-- name: auth.refresh_lookup
-- Used after refresh_redeem reports 0 rows: tells reuse (revoked_at IS NOT NULL)
-- apart from expired/unknown.
SELECT user_id, expires_at, revoked_at
FROM refresh_tokens
WHERE token_hash = $1;

-- name: auth.refresh_revoke_token
UPDATE refresh_tokens
SET revoked_at = now()
WHERE token_hash = $1 AND revoked_at IS NULL;

-- name: auth.refresh_revoke_user
-- Defensive blast on suspected reuse: revoke every still-active token for
-- the affected user, forcing all sessions to re-login.
UPDATE refresh_tokens
SET revoked_at = now()
WHERE user_id = $1 AND revoked_at IS NULL;

-- name: auth.refresh_purge_expired
DELETE FROM refresh_tokens
WHERE expires_at < now() - INTERVAL '7 days';
