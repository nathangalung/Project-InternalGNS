-- +goose Up

-- Sessions were ended by comparing the access token's iat, stamped by the
-- API host clock, with sessions_valid_from, stamped by the Postgres clock.
-- A wall-clock step on either side made a token minted right after a reset
-- look older than the epoch, so the login the reset forced was refused. An
-- integer version has no clock: every access token carries the version it
-- was minted under, and the middleware refuses any other.
ALTER TABLE users
  ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN users.session_version IS
  'Bumped on a role change, deactivation or password change. Access and refresh tokens minted under an older version are refused.';

-- Existing refresh tokens are bound to version 1 so live sessions survive
-- the deploy: an access token without the claim is refused, and the client
-- refreshes into one that carries it. New rows must name their version.
ALTER TABLE refresh_tokens
  ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE refresh_tokens
  ALTER COLUMN session_version DROP DEFAULT;

COMMENT ON COLUMN refresh_tokens.session_version IS
  'The owner''s users.session_version when this token was minted. Redeemable only while the two match.';

ALTER TABLE users DROP COLUMN sessions_valid_from;

-- +goose Down
ALTER TABLE users
  ADD COLUMN sessions_valid_from TIMESTAMPTZ NOT NULL
    DEFAULT date_trunc('second', now());

COMMENT ON COLUMN users.sessions_valid_from IS
  'Access tokens issued before this instant are refused. Bumped on password change.';

ALTER TABLE refresh_tokens DROP COLUMN session_version;
ALTER TABLE users DROP COLUMN session_version;
