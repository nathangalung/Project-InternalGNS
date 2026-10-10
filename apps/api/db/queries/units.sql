-- name: units.list_all
SELECT u.id, u.code, u.name, u.coretax_code,
       COALESCE(array_agg(a.alias ORDER BY a.alias) FILTER (WHERE a.alias IS NOT NULL), '{}') AS aliases
FROM units u
LEFT JOIN unit_aliases a ON a.unit_id = u.id
GROUP BY u.id
ORDER BY u.id;
