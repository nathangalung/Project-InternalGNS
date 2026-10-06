-- name: cash_entries.list_base
SELECT c.id, c.entry_date::text AS entry_date, c.direction, c.category,
       c.amount::text AS amount, c.description, c.row_version,
       c.created_at, c.updated_at, u.name AS created_by_name
FROM cash_entries c
JOIN users u ON u.id = c.created_by
WHERE 1=1;

-- name: cash_entries.list_count_base
SELECT COUNT(*) FROM cash_entries c
WHERE 1=1;

-- name: cash_entries.summary_base
-- Totals of the filtered entries, before paging.
SELECT COALESCE(SUM(c.amount) FILTER (WHERE c.direction = 'in'), 0)::text  AS total_in,
       COALESCE(SUM(c.amount) FILTER (WHERE c.direction = 'out'), 0)::text AS total_out,
       (COALESCE(SUM(c.amount) FILTER (WHERE c.direction = 'in'), 0)
        - COALESCE(SUM(c.amount) FILTER (WHERE c.direction = 'out'), 0))::text AS net
FROM cash_entries c
WHERE 1=1;

-- name: cash_entries.get
SELECT c.id, c.entry_date::text AS entry_date, c.direction, c.category,
       c.amount::text AS amount, c.description, c.row_version,
       c.created_at, c.updated_at, u.name AS created_by_name
FROM cash_entries c
JOIN users u ON u.id = c.created_by
WHERE c.id = $1;

-- name: cash_entries.create
INSERT INTO cash_entries (entry_date, direction, category, amount, description, created_by, updated_by)
VALUES ($1::date, $2, $3, $4::numeric, $5, $6, $6)
RETURNING id;

-- name: cash_entries.update
-- Only the version the caller read is changed; no row back means a missing
-- entry or a stale version, which cash_entries.exists tells apart.
UPDATE cash_entries
   SET entry_date = $2::date, direction = $3, category = $4,
       amount = $5::numeric, description = $6, updated_by = $7
 WHERE id = $1 AND row_version = $8
RETURNING id;

-- name: cash_entries.exists
SELECT EXISTS (SELECT 1 FROM cash_entries WHERE id = $1);

-- name: cash_entries.delete
DELETE FROM cash_entries WHERE id = $1;

-- name: cash_entries.categories
-- Categories in use, most used first, for the form's suggestions.
SELECT category FROM cash_entries
GROUP BY category
ORDER BY COUNT(*) DESC, category
LIMIT 50;
