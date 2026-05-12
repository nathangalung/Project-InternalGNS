# public.v_quotation_request_audit

## Description

<details>
<summary><strong>Table Definition</strong></summary>

```sql
CREATE VIEW v_quotation_request_audit AS (
 SELECT q.id AS quotation_id,
    q.quotation_no,
    q.status AS quotation_status,
    qir.id AS request_id,
    qir.line_no,
    qir.request_text AS client_requested,
    qir.request_impa,
    qir.requested_qty,
    qir.requested_uom,
    qir.match_status,
    qir.source_type,
    qir.source_ref,
    i_match.id AS matched_item_id,
    i_match.name AS matched_item_name,
    i_match.impa_code AS matched_item_impa,
    qi.id AS quotation_item_id,
    qi.line_number AS quoted_line_number,
    qi.qty AS quoted_qty,
    qi.selling_price AS quoted_selling_price,
    qi.is_available AS quoted_is_available,
    i_offer.id AS offered_item_id,
    i_offer.name AS offered_item_name,
    qir.notes,
    qir.reviewed_by,
    qir.reviewed_at,
    qir.created_at,
    qir.updated_at
   FROM ((((quotations q
     LEFT JOIN quotation_item_requests qir ON ((qir.quotation_id = q.id)))
     LEFT JOIN items i_match ON ((i_match.id = qir.matched_item_id)))
     LEFT JOIN quotation_items qi ON ((qi.request_id = qir.id)))
     LEFT JOIN items i_offer ON ((i_offer.id = qi.offered_item_id)))
)
```

</details>

## Columns

| Name                 | Type                     | Default | Nullable | Children | Parents | Comment |
| -------------------- | ------------------------ | ------- | -------- | -------- | ------- | ------- |
| quotation_id         | bigint                   |         | true     |          |         |         |
| quotation_no         | varchar(50)              |         | true     |          |         |         |
| quotation_status     | varchar(20)              |         | true     |          |         |         |
| request_id           | bigint                   |         | true     |          |         |         |
| line_no              | integer                  |         | true     |          |         |         |
| client_requested     | text                     |         | true     |          |         |         |
| request_impa         | varchar(20)              |         | true     |          |         |         |
| requested_qty        | numeric(15,3)            |         | true     |          |         |         |
| requested_uom        | varchar(20)              |         | true     |          |         |         |
| match_status         | varchar(20)              |         | true     |          |         |         |
| source_type          | varchar(20)              |         | true     |          |         |         |
| source_ref           | text                     |         | true     |          |         |         |
| matched_item_id      | bigint                   |         | true     |          |         |         |
| matched_item_name    | varchar(500)             |         | true     |          |         |         |
| matched_item_impa    | varchar(20)              |         | true     |          |         |         |
| quotation_item_id    | bigint                   |         | true     |          |         |         |
| quoted_line_number   | smallint                 |         | true     |          |         |         |
| quoted_qty           | numeric(12,2)            |         | true     |          |         |         |
| quoted_selling_price | numeric(15,2)            |         | true     |          |         |         |
| quoted_is_available  | boolean                  |         | true     |          |         |         |
| offered_item_id      | bigint                   |         | true     |          |         |         |
| offered_item_name    | varchar(500)             |         | true     |          |         |         |
| notes                | text                     |         | true     |          |         |         |
| reviewed_by          | bigint                   |         | true     |          |         |         |
| reviewed_at          | timestamp with time zone |         | true     |          |         |         |
| created_at           | timestamp with time zone |         | true     |          |         |         |
| updated_at           | timestamp with time zone |         | true     |          |         |         |

## Referenced Tables

| Name                                                                | Columns | Comment | Type       |
| ------------------------------------------------------------------- | ------- | ------- | ---------- |
| [public.quotations](public.quotations.md)                           | 27      |         | BASE TABLE |
| [public.quotation_item_requests](public.quotation_item_requests.md) | 19      |         | BASE TABLE |
| [public.items](public.items.md)                                     | 11      |         | BASE TABLE |
| [public.quotation_items](public.quotation_items.md)                 | 30      |         | BASE TABLE |

## Relations

![er](public.v_quotation_request_audit.svg)

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
