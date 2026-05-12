-- +goose Up
-- +goose StatementBegin

-- Refresh tokens for the rotation pattern: long-lived opaque token paired
-- with a short-lived JWT. Token bodies are random 32-byte values; only
-- their SHA-256 digest is stored to keep DB compromise from yielding live
-- tokens. Lookup is indexed on token_hash; user_id is indexed for the
-- "revoke all on reuse" path. The unique constraint on token_hash also
-- guards against the (astronomically unlikely) collision.

CREATE TABLE refresh_tokens (
    id          BIGSERIAL    PRIMARY KEY,
    user_id     BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  BYTEA        NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ  NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    revoked_at  TIMESTAMPTZ
);

CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens(user_id);

COMMENT ON TABLE refresh_tokens IS
  'Opaque refresh tokens (SHA-256 hashed). Rotation on use, revocation on logout.';
COMMENT ON COLUMN refresh_tokens.token_hash IS
  'SHA-256(token); never store the raw token. 32 bytes.';
COMMENT ON COLUMN refresh_tokens.revoked_at IS
  'Set when the token is consumed (rotated) or explicitly revoked. NULL = active.';

-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS refresh_tokens;

-- +goose StatementEnd
