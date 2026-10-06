-- +goose Up
-- 00104 INPUT ROLES
-- Operational and finance each split into a head and a data input role.
-- The existing operational and finance users stay heads; the input roles
-- see and change less (CLAUDE.md, Roles).
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('superadmin', 'operational', 'operational_input', 'finance', 'finance_input'));

-- +goose Down
-- Input users must be moved to another role before this runs.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('operational', 'finance', 'superadmin'));
