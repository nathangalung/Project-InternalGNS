-- name: clients.list_base
SELECT cc.id, cc.number, cc.name, cc.npwp, cc.address, cc.email, cc.country_code,
       cc.tku_id, cc.is_active, cc.created_at, cc.updated_at,
       co.id    AS contact_id,
       co.name  AS contact_name,
       co.email AS contact_email,
       co.phone AS contact_phone,
       COALESCE((SELECT SUM(q.grand_total)::TEXT
                 FROM quotations q
                 WHERE q.company_client_id = cc.id
                   AND q.status = 'accepted'), '0') AS total_purchase,
       COALESCE((SELECT COUNT(*)
                 FROM quotations q
                 WHERE q.company_client_id = cc.id), 0)::BIGINT AS quotation_count,
       cc.logo_object_key
FROM company_client cc
LEFT JOIN LATERAL (
    SELECT id, name, email, phone
    FROM company_contacts
    WHERE company_id = cc.id AND is_active = TRUE
    ORDER BY id ASC
    LIMIT 1
) co ON TRUE
WHERE 1=1;

-- name: clients.list_count_base
SELECT COUNT(*)
FROM company_client cc
LEFT JOIN LATERAL (
    SELECT name
    FROM company_contacts
    WHERE company_id = cc.id AND is_active = TRUE
    ORDER BY id ASC
    LIMIT 1
) co ON TRUE
WHERE 1=1;

-- name: clients.get_by_id
SELECT cc.id, cc.number, cc.name, cc.npwp, cc.address, cc.email, cc.country_code,
       cc.tku_id, cc.is_active, cc.created_at, cc.updated_at,
       co.id    AS contact_id,
       co.name  AS contact_name,
       co.email AS contact_email,
       co.phone AS contact_phone,
       COALESCE((SELECT SUM(q.grand_total)::TEXT
                 FROM quotations q
                 WHERE q.company_client_id = cc.id
                   AND q.status = 'accepted'), '0') AS total_purchase,
       COALESCE((SELECT COUNT(*)
                 FROM quotations q
                 WHERE q.company_client_id = cc.id), 0)::BIGINT AS quotation_count,
       cc.logo_object_key
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
       NULL::TEXT   AS contact_phone,
       '0'::TEXT    AS total_purchase,
       0::BIGINT    AS quotation_count,
       NULL::TEXT   AS logo_object_key
FROM ins;

-- name: clients.update
UPDATE company_client
   SET name         = $2,
       npwp         = $3,
       address      = $4,
       email        = $5,
       country_code = COALESCE(NULLIF($6, ''), country_code),
       tku_id       = $7,
       is_active    = $8,
       updated_by   = $9,
       updated_at   = NOW()
 WHERE id = $1
RETURNING id, number, name, npwp, address, email, country_code,
          tku_id, is_active, created_at, updated_at,
          NULL::BIGINT AS contact_id,
          NULL::TEXT   AS contact_name,
          NULL::TEXT   AS contact_email,
          NULL::TEXT   AS contact_phone,
          COALESCE((SELECT SUM(q.grand_total)::TEXT
                    FROM quotations q
                    WHERE q.company_client_id = company_client.id
                      AND q.status = 'accepted'), '0') AS total_purchase,
          COALESCE((SELECT COUNT(*)
                    FROM quotations q
                    WHERE q.company_client_id = company_client.id), 0)::BIGINT AS quotation_count,
          logo_object_key;

-- name: clients.update_logo
UPDATE company_client
   SET logo_object_key = $2,
       updated_by      = $3,
       updated_at      = NOW()
 WHERE id = $1
RETURNING id;

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

-- name: clients.update_contact
UPDATE company_contacts
   SET name = $3,
       email = COALESCE($4, email),
       phone = $5,
       title = COALESCE($6, title),
       country_code = COALESCE(NULLIF($7, ''), country_code),
       updated_by = $8
 WHERE id = $2 AND company_id = $1
RETURNING id, company_id, name, email, phone, title, country_code,
          is_active, created_at, updated_at;

-- name: clients.deactivate_contact
UPDATE company_contacts
   SET is_active = FALSE, updated_by = $3
 WHERE id = $2 AND company_id = $1 AND is_active = TRUE;


-- name: clients.summary
SELECT
  COUNT(*)::BIGINT AS total,
  COUNT(*) FILTER (WHERE is_active = TRUE)::BIGINT AS active_count,
  COUNT(*) FILTER (WHERE created_at >= date_trunc('month', NOW() AT TIME ZONE 'Asia/Jakarta'))::BIGINT AS new_this_month,
  COUNT(*) FILTER (WHERE created_at >= date_trunc('year',  NOW() AT TIME ZONE 'Asia/Jakarta'))::BIGINT AS new_this_year,
  COUNT(*) FILTER (WHERE created_at <  date_trunc('year',  NOW() AT TIME ZONE 'Asia/Jakarta'))::BIGINT AS prev_year_total
FROM company_client;
