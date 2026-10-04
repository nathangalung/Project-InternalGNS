-- name: clients.list_base
SELECT cc.id, cc.number, cc.name, cc.npwp, cc.address, cc.email, cc.country_code,
       cc.tku_id, cc.is_active, cc.created_at, cc.updated_at,
       co.id    AS contact_id,
       co.name  AS contact_name,
       co.email AS contact_email,
       co.phone AS contact_phone,
       COALESCE((SELECT SUM(CASE WHEN po.id IS NULL THEN q.grand_total
                                 ELSE (SELECT t.po_grand_total FROM v_po_totals t
                                       WHERE t.po_id = po.id) END)::TEXT
                 FROM quotations q
                 LEFT JOIN purchase_orders po ON po.quotation_id = q.id
                 WHERE q.company_client_id = cc.id
                   AND q.status = 'accepted'
                   AND po.status IS DISTINCT FROM 'CANCELLED'), '0') AS total_purchase,
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
       COALESCE((SELECT SUM(CASE WHEN po.id IS NULL THEN q.grand_total
                                 ELSE (SELECT t.po_grand_total FROM v_po_totals t
                                       WHERE t.po_id = po.id) END)::TEXT
                 FROM quotations q
                 LEFT JOIN purchase_orders po ON po.quotation_id = q.id
                 WHERE q.company_client_id = cc.id
                   AND q.status = 'accepted'
                   AND po.status IS DISTINCT FROM 'CANCELLED'), '0') AS total_purchase,
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

-- name: clients.get_by_ids
-- Same projection as clients.get_by_id, for many clients in one round-trip.
-- Ids with no row are simply absent; $1=client ids.
SELECT cc.id, cc.number, cc.name, cc.npwp, cc.address, cc.email, cc.country_code,
       cc.tku_id, cc.is_active, cc.created_at, cc.updated_at,
       co.id    AS contact_id,
       co.name  AS contact_name,
       co.email AS contact_email,
       co.phone AS contact_phone,
       COALESCE((SELECT SUM(CASE WHEN po.id IS NULL THEN q.grand_total
                                 ELSE (SELECT t.po_grand_total FROM v_po_totals t
                                       WHERE t.po_id = po.id) END)::TEXT
                 FROM quotations q
                 LEFT JOIN purchase_orders po ON po.quotation_id = q.id
                 WHERE q.company_client_id = cc.id
                   AND q.status = 'accepted'
                   AND po.status IS DISTINCT FROM 'CANCELLED'), '0') AS total_purchase,
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
WHERE cc.id = ANY($1::bigint[])
ORDER BY cc.id;

-- name: clients.create
-- A NULL number draws the next free one; COALESCE is lazy, so a supplied
-- number never consumes a sequence value.
WITH ins AS (
    INSERT INTO company_client
        (number, name, npwp, address, email, country_code, tku_id, created_by, updated_by)
    VALUES
        (COALESCE(NULLIF(BTRIM($1::text), ''), fn_next_client_number()),
         $2, $3, $4, $5, COALESCE(NULLIF($6, ''), 'IDN'), $7, $8, $8)
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
-- A NULL $10 keeps the number. The row comes back as clients.get_by_id
-- reads it, main contact included.
WITH upd AS (
    UPDATE company_client
       SET number       = COALESCE($10::text, number),
           name         = $2,
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
              tku_id, is_active, created_at, updated_at, logo_object_key
)
SELECT upd.id, upd.number, upd.name, upd.npwp, upd.address, upd.email, upd.country_code,
       upd.tku_id, upd.is_active, upd.created_at, upd.updated_at,
       co.id    AS contact_id,
       co.name  AS contact_name,
       co.email AS contact_email,
       co.phone AS contact_phone,
       COALESCE((SELECT SUM(CASE WHEN po.id IS NULL THEN q.grand_total
                                 ELSE (SELECT t.po_grand_total FROM v_po_totals t
                                       WHERE t.po_id = po.id) END)::TEXT
                 FROM quotations q
                 LEFT JOIN purchase_orders po ON po.quotation_id = q.id
                 WHERE q.company_client_id = upd.id
                   AND q.status = 'accepted'
                   AND po.status IS DISTINCT FROM 'CANCELLED'), '0') AS total_purchase,
       COALESCE((SELECT COUNT(*)
                 FROM quotations q
                 WHERE q.company_client_id = upd.id), 0)::BIGINT AS quotation_count,
       upd.logo_object_key
FROM upd
LEFT JOIN LATERAL (
    SELECT id, name, email, phone
    FROM company_contacts
    WHERE company_id = upd.id AND is_active = TRUE
    ORDER BY id ASC
    LIMIT 1
) co ON TRUE;

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

-- name: clients.get_contact
-- One contact of the company, active or not: a document keeps the contact
-- it chose after that contact is deactivated.
SELECT id, company_id, name, email, phone, title, country_code,
       is_active, created_at, updated_at
FROM company_contacts
WHERE company_id = $1 AND id = $2;

-- name: clients.create_contact
-- A blank email or title is stored as NULL: two blank emails would otherwise
-- collide on the unique email index.
INSERT INTO company_contacts
    (company_id, name, email, phone, title, country_code, created_by, updated_by)
VALUES
    ($1, $2, NULLIF(BTRIM($3), ''), $4, NULLIF(BTRIM($5), ''),
     COALESCE(NULLIF($6, ''), 'IDN'), $7, $7)
RETURNING id, company_id, name, email, phone, title, country_code,
          is_active, created_at, updated_at;

-- name: clients.update_contact
-- PATCH: $4 and $7 say whether email and title were sent; a sent null or
-- blank clears the column. A deleted contact is not editable.
UPDATE company_contacts
   SET name = $3,
       email = CASE WHEN $4::boolean THEN NULLIF(BTRIM($5::text), '') ELSE email END,
       phone = $6,
       title = CASE WHEN $7::boolean THEN NULLIF(BTRIM($8::text), '') ELSE title END,
       country_code = COALESCE(NULLIF($9, ''), country_code),
       updated_by = $10
 WHERE id = $2 AND company_id = $1 AND is_active = TRUE
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

-- name: clients.recent_quotations
-- The client's newest quotations that reached it (every status but draft
-- and cancelled), with the number of product lines offered. $2 = limit.
SELECT q.id, q.quotation_no, q.created_at, q.status, q.contact_name,
       q.grand_total::text AS grand_total,
       (SELECT count(*) FROM quotation_items qi
        WHERE qi.quotation_id = q.id AND qi.item_type = 'product' AND qi.is_available)::int AS product_count
FROM quotations q
WHERE q.company_client_id = $1
  AND q.status NOT IN ('draft', 'cancelled')
ORDER BY q.created_at DESC, q.id DESC
LIMIT $2;
