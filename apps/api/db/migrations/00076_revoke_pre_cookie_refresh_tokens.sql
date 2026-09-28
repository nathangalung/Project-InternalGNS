-- +goose Up

-- 00076 REVOKE PRE-COOKIE REFRESH TOKENS
-- Before the cookie sessions release the SPA kept the refresh token in
-- sessionStorage, where any script on the page could read it. A token taken
-- that way works from outside a browser, since the Origin and CSRF-header
-- checks only bind browsers, so it would stay good for its full expiry
-- (REFRESH_TOKEN_EXPIRY, 720h by default). Everyone signs in again after this
-- release anyway, so end every live token now. The reason is not 'rotated',
-- so presenting one is a plain revoked session, not a replay that blasts
-- the sessions started after the deploy.

UPDATE refresh_tokens
   SET revoked_at = now(), revoked_reason = 'cookie_migration'
 WHERE revoked_at IS NULL;

COMMENT ON COLUMN refresh_tokens.revoked_reason IS
  'Why the token was revoked: rotated, logout, admin, reuse, cookie_migration. NULL on legacy rows.';

-- +goose Down

-- The revocation stays: a token that sat in sessionStorage is not brought
-- back to life. Only the column comment is restored.
COMMENT ON COLUMN refresh_tokens.revoked_reason IS
  'Why the token was revoked: rotated, logout, admin, reuse. NULL on legacy rows.';
