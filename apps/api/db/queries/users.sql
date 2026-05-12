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

-- name: users.exists_email_other
SELECT COUNT(*)
FROM users
WHERE LOWER(email) = LOWER($1) AND id <> $2;
