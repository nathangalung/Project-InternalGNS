-- name: auth.refresh_insert
-- $4 is the owner's session version the token is bound to.
INSERT INTO refresh_tokens (user_id, token_hash, expires_at, session_version)
VALUES ($1, $2, $3, $4)
RETURNING id;

-- name: auth.refresh_redeem
-- Atomically revoke an active, non-expired refresh token still bound to its
-- owner's session version, and return (user_id, session_version). 0 rows
-- means it does not exist, is expired, was already revoked, or predates a
-- version bump — the caller distinguishes via refresh_lookup.
-- expires_at is compared against clock_timestamp() (real wall-clock at
-- statement time) so a long-running tx cannot resurrect a token that
-- expired mid-transaction.
UPDATE refresh_tokens t
SET revoked_at = clock_timestamp(), revoked_reason = 'rotated'
FROM users u
WHERE t.token_hash = $1
  AND u.id = t.user_id
  AND t.revoked_at IS NULL
  AND t.expires_at > clock_timestamp()
  AND t.session_version = u.session_version
RETURNING t.user_id, u.session_version;

-- name: auth.refresh_lookup
-- Used after refresh_redeem reports 0 rows: tells reuse (revoked_at IS NOT NULL)
-- apart from a version bump, expired and unknown.
SELECT t.user_id,
       t.revoked_at,
       t.revoked_reason,
       t.session_version <> u.session_version AS stale
FROM refresh_tokens t
JOIN users u ON u.id = t.user_id
WHERE t.token_hash = $1;

-- name: auth.refresh_revoke_token
UPDATE refresh_tokens
SET revoked_at = now(), revoked_reason = 'logout'
WHERE token_hash = $1 AND revoked_at IS NULL;

-- name: auth.refresh_revoke_user
-- Defensive blast on suspected reuse: revoke every still-active token for
-- the affected user, forcing all sessions to re-login.
UPDATE refresh_tokens
SET revoked_at = now(), revoked_reason = $2
WHERE user_id = $1 AND revoked_at IS NULL;

-- name: auth.refresh_purge_expired
DELETE FROM refresh_tokens
WHERE expires_at < now() - INTERVAL '7 days';

-- name: auth.refresh_lock_owner
-- Share-locks the token owner's users row for the refresh transaction. A
-- password change or deactivation writes that row, so it either commits
-- first (and the redeem then finds the token revoked) or waits until the
-- successor token exists, and revokes it too.
SELECT u.id
FROM refresh_tokens t
JOIN users u ON u.id = t.user_id
WHERE t.token_hash = $1
FOR SHARE OF u;
