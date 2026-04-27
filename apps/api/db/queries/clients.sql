-- name: clients.list
SELECT id, number, name, npwp, address, email, country_code,
       tku_id, is_active, created_at, updated_at
FROM company_client
WHERE is_active = TRUE
ORDER BY name
LIMIT $1 OFFSET $2;

-- name: clients.get_by_id
SELECT id, number, name, npwp, address, email, country_code,
       tku_id, is_active, created_at, updated_at
FROM company_client
WHERE id = $1;

-- name: clients.create
INSERT INTO company_client
    (number, name, npwp, address, email, country_code, tku_id, created_by, updated_by)
VALUES
    ($1, $2, $3, $4, $5, COALESCE(NULLIF($6, ''), 'IDN'), $7, $8, $8)
RETURNING id, number, name, npwp, address, email, country_code,
          tku_id, is_active, created_at, updated_at;

-- name: clients.search
SELECT * FROM fn_search_clients($1, $2, $3);

-- name: clients.list_contacts
SELECT id, company_id, name, email, phone, title, country_code,
       is_active, created_at, updated_at
FROM company_contacts
WHERE company_id = $1 AND is_active = TRUE
ORDER BY name;

-- name: clients.create_contact
INSERT INTO company_contacts
    (company_id, name, email, phone, title, country_code, created_by, updated_by)
VALUES
    ($1, $2, $3, $4, $5, COALESCE(NULLIF($6, ''), 'IDN'), $7, $7)
RETURNING id, company_id, name, email, phone, title, country_code,
          is_active, created_at, updated_at;
