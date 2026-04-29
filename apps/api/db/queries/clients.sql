-- name: clients.list
SELECT cc.id, cc.number, cc.name, cc.npwp, cc.address, cc.email, cc.country_code,
       cc.tku_id, cc.is_active, cc.created_at, cc.updated_at,
       co.id    AS contact_id,
       co.name  AS contact_name,
       co.email AS contact_email,
       co.phone AS contact_phone
FROM company_client cc
LEFT JOIN LATERAL (
    SELECT id, name, email, phone
    FROM company_contacts
    WHERE company_id = cc.id AND is_active = TRUE
    ORDER BY id ASC
    LIMIT 1
) co ON TRUE
WHERE cc.is_active = TRUE
ORDER BY cc.name
LIMIT $1 OFFSET $2;

-- name: clients.get_by_id
SELECT cc.id, cc.number, cc.name, cc.npwp, cc.address, cc.email, cc.country_code,
       cc.tku_id, cc.is_active, cc.created_at, cc.updated_at,
       co.id    AS contact_id,
       co.name  AS contact_name,
       co.email AS contact_email,
       co.phone AS contact_phone
FROM company_client cc
LEFT JOIN LATERAL (
    SELECT id, name, email, phone
    FROM company_contacts
    WHERE company_id = cc.id AND is_active = TRUE
    ORDER BY id ASC
    LIMIT 1
) co ON TRUE
WHERE cc.id = $1;

-- name: clients.create
WITH ins AS (
    INSERT INTO company_client
        (number, name, npwp, address, email, country_code, tku_id, created_by, updated_by)
    VALUES
        ($1, $2, $3, $4, $5, COALESCE(NULLIF($6, ''), 'IDN'), $7, $8, $8)
    RETURNING id, number, name, npwp, address, email, country_code,
              tku_id, is_active, created_at, updated_at
)
SELECT ins.id, ins.number, ins.name, ins.npwp, ins.address, ins.email, ins.country_code,
       ins.tku_id, ins.is_active, ins.created_at, ins.updated_at,
       NULL::BIGINT AS contact_id,
       NULL::TEXT   AS contact_name,
       NULL::TEXT   AS contact_email,
       NULL::TEXT   AS contact_phone
FROM ins;

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
