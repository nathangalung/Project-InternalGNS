-- +goose NO TRANSACTION

-- +goose Up
-- Every auth lookup matches on LOWER(email) but UNIQUE(email) is
-- case-sensitive, so Admin@x and admin@x could both exist and which row
-- authenticates was planner-dependent. Make case-folded uniqueness a schema
-- invariant. Drop-then-create so a retry after an interrupted CONCURRENTLY
-- build repairs an INVALID leftover instead of skipping it by name.
-- users_email_key stays: SeedSuperadmin uses ON CONFLICT (email), which can
-- infer that constraint but not an expression index.
DROP INDEX IF EXISTS users_email_lower_idx;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS users_email_lower_idx
  ON users (LOWER(email));

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS users_email_lower_idx;
