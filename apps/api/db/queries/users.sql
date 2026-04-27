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

-- name: users.create
INSERT INTO users (email, name, password_hash, role, created_by, updated_by)
VALUES ($1, $2, $3, $4, $5, $5)
RETURNING id, email, name, password_hash, role,
          is_active, created_at, updated_at;

-- name: users.update_password
UPDATE users
SET password_hash = $1, updated_by = $2
WHERE id = $3;
