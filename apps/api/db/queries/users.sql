-- name: users.get_by_email
SELECT id, email, name, password_hash, role,
       is_active, created_at, updated_at
FROM users
WHERE LOWER(email) = LOWER($1) AND is_active = TRUE;

-- name: users.get_by_id
SELECT id, email, name, password_hash, role,
       is_active, created_at, updated_at
FROM users
WHERE id = $1 AND is_active = TRUE;

-- name: users.lock_status
SELECT failed_login_attempts, locked_until
FROM users
WHERE LOWER(email) = LOWER($1) AND is_active = TRUE;

-- name: users.record_failed_login
UPDATE users
   SET failed_login_attempts = failed_login_attempts + 1,
       locked_until = CASE
         WHEN failed_login_attempts + 1 >= 5
         THEN now() + interval '15 minutes'
         ELSE locked_until
       END
 WHERE LOWER(email) = LOWER($1) AND is_active = TRUE;

-- name: users.reset_login_attempts
UPDATE users
   SET failed_login_attempts = 0, locked_until = NULL
 WHERE LOWER(email) = LOWER($1) AND is_active = TRUE;

-- name: users.create
INSERT INTO users (email, name, password_hash, role, is_active, created_by, updated_by)
VALUES ($1, $2, $3, $4, COALESCE($5, TRUE), $6, $6)
RETURNING id, email, name, password_hash, role,
          is_active, created_at, updated_at;

-- name: users.update_password
UPDATE users
SET password_hash = $1, updated_by = $2
WHERE id = $3;

-- name: users.list_count_base
SELECT COUNT(*) FROM users
WHERE 1=1;

-- name: users.list_base
SELECT id, email, name, password_hash, role,
       is_active, created_at, updated_at
FROM users
WHERE 1=1;

-- name: users.update
UPDATE users
SET name = $2,
    email = $3,
    role = $4,
    is_active = $5,
    updated_by = $6
WHERE id = $1
RETURNING id, email, name, password_hash, role,
          is_active, created_at, updated_at;

-- name: users.update_precheck
-- Prior state of the target plus whether another active superadmin remains.
-- No is_active filter: an inactive user is still updatable (reactivation).
SELECT role,
       is_active,
       EXISTS (
         SELECT 1 FROM users
         WHERE role = 'superadmin' AND is_active = TRUE AND id <> $1
       ) AS other_active_superadmin
FROM users
WHERE id = $1;

-- name: users.exists_email_other
SELECT COUNT(*)
FROM users
WHERE LOWER(email) = LOWER($1) AND id <> $2;
