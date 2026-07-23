"""Additive 2024 loader. Same shape as load_2025.py — appends to live DB
without TRUNCATE.

Reads staged.json (assumed to contain only 2024 files), inserts the 3 new
customers (IDs 16..18) if missing, dedups items/vendors/contacts/
vendor_products against current DB state, then inserts every quotation in
chronological order. Q-numbers are regenerated Python-side from each file's
historical 2024 date so a March 2024 file gets `/III/2024`. After all
inserts, doc_sequences is upserted for (Q, company_id, 2024) so the API's
fn_next_doc_no continues from the right last_seq going forward.

Run:  uv run load_2024.py [--dry-run]
"""
from __future__ import annotations
import argparse
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

try:
    import psycopg
except ImportError:
    print("Need psycopg: uv add 'psycopg[binary]'", file=sys.stderr)
    sys.exit(1)

# Reuse helpers + canonical customer master from the base loader.
from load import (
    CUSTOMERS,
    SUPERADMIN_ID,
    DEFAULT_DSN,
    item_dedup_key,
    norm_name,
    normalize_phone,
    py_next_doc_no,
    truncate_to,
)
# Reuse the additive insert helpers from the 2025 loader so behaviour stays
# in sync (they're DB-state-aware and idempotent against existing rows).
from load_2025 import (
    fetch_unit_map,
    load_existing_items,
    load_existing_vendors,
    load_existing_vendor_products,
    load_existing_contacts,
    insert_new_items,
    insert_new_vendors,
    insert_new_vendor_products,
    insert_new_contacts,
    build_lines,
    insert_quotation,
)
from unit_map import canonical_unit


STAGED_FILE = Path(__file__).parent / "staged.json"
DSN = os.environ.get("DATABASE_URL", DEFAULT_DSN)

# IDs of customers introduced specifically for 2024 data.
NEW_CUSTOMER_IDS = {16, 17, 18}

CUSTOMER_NAME_TO_ID: dict[str, int] = {c[2]: c[0] for c in CUSTOMERS}


def load_staged() -> list[dict]:
    raw = json.loads(STAGED_FILE.read_text(encoding="utf-8"))
    return raw["parsed"]


def ensure_new_customers(cur):
    """Insert customers 4016..4018 if missing."""
    rows = [c for c in CUSTOMERS if c[0] in NEW_CUSTOMER_IDS]
    for cid, num, name in rows:
        cur.execute(
            """INSERT INTO company_client
                    (id, number, name, country_code, created_by, updated_by)
                VALUES (%s, %s, %s, 'IDN', %s, %s)
                ON CONFLICT (id) DO NOTHING""",
            (cid, num, name, SUPERADMIN_ID, SUPERADMIN_ID),
        )
    cur.execute(
        "SELECT setval('company_client_id_seq', "
        "GREATEST((SELECT MAX(id) FROM company_client), 1), true)"
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true",
                        help="Run inside a tx then ROLLBACK")
    args = parser.parse_args()

    parsed = load_staged()
    # Defensive: this script is for 2024 data only.
    parsed = [r for r in parsed
              if r.get("date_iso") and r["date_iso"].startswith("2024")]
    print(f"Loaded {len(parsed)} files for year 2024")

    parsed.sort(key=lambda r: (r["date_iso"] or "9999-99-99",
                               r["raw_qno_norm"] or ""))

    groups: dict[str, list[dict]] = defaultdict(list)
    for r in parsed:
        groups[r["raw_qno_norm"] or r["file"]].append(r)
    print(f"  -> {len(groups)} qno groups; "
          f"{sum(1 for g in groups.values() if len(g) > 1)} have duplicates")

    print(f"\nConnecting to: {DSN}")
    with psycopg.connect(DSN, autocommit=False) as conn:
        with conn.cursor() as cur:
            ensure_new_customers(cur)

            unit_id_by_code = fetch_unit_map(cur)
            print(f">> {len(unit_id_by_code)} unit codes loaded")

            items_id_map = load_existing_items(cur)
            vendor_id_map = load_existing_vendors(cur)
            vp_lookup = load_existing_vendor_products(cur)
            contacts_id_map, used_emails = load_existing_contacts(cur)
            print(f">> existing: {len(items_id_map)} items, "
                  f"{len(vendor_id_map)} vendors, {len(vp_lookup)} vp, "
                  f"{len(contacts_id_map)} contacts")

            ni = insert_new_items(cur, parsed, unit_id_by_code, items_id_map)
            nv = insert_new_vendors(cur, parsed, vendor_id_map)
            nvp = insert_new_vendor_products(cur, parsed, vendor_id_map,
                                              items_id_map, vp_lookup)
            nc = insert_new_contacts(cur, parsed, contacts_id_map, used_emails)
            print(f">> inserted new: {ni} items, {nv} vendors, "
                  f"{nvp} vendor_products, {nc} contacts")

            # insert_quotation writes 1 qir row per qi row, but trg_qir_lock_parent
            # blocks qir writes for non-draft quotation status. Disable for bulk
            # window; DDL is transactional so rollback restores.
            cur.execute("ALTER TABLE quotation_item_requests DISABLE TRIGGER trg_qir_lock_parent")

            seq_counter: dict[tuple[int, int], int] = defaultdict(int)
            n_inserted = 0
            n_versions = 0
            n_drafts = 0
            for qkey, group in groups.items():
                group.sort(key=lambda r: r["date_iso"] or "9999-99-99")
                prev_id: int | None = None
                for v_idx, file_data in enumerate(group, start=1):
                    cust_id = CUSTOMER_NAME_TO_ID[file_data["customer_name"]]
                    contact_id = None
                    if file_data.get("contact_name"):
                        contact_id = contacts_id_map.get(
                            (cust_id, norm_name(file_data["contact_name"]))
                        )
                    items = build_lines(file_data, items_id_map,
                                         vendor_id_map, vp_lookup,
                                         unit_id_by_code)
                    if not items:
                        continue
                    is_draft = not any(
                        (it["selling_price"] or 0) > 0 for it in items
                    )
                    status = "draft" if is_draft else "sent"
                    if is_draft:
                        n_drafts += 1
                        print(f"  [draft] {file_data.get('file')}")

                    try:
                        d = datetime.strptime(file_data["date_iso"], "%Y-%m-%d")
                    except (ValueError, TypeError, KeyError):
                        d = datetime(2024, 1, 1)
                    year, month = d.year, d.month
                    seq_key = (cust_id, year)
                    seq_counter[seq_key] += 1

                    qid = insert_quotation(
                        cur, file_data, cust_id, contact_id, items,
                        version=v_idx, parent_id=prev_id,
                        seq=seq_counter[seq_key], year=year, month=month,
                        status=status,
                    )
                    prev_id = qid
                    n_inserted += 1
                    if v_idx > 1:
                        n_versions += 1

            if seq_counter:
                rows = [
                    ("Q", cid, yr, last_seq)
                    for (cid, yr), last_seq in seq_counter.items()
                ]
                cur.executemany(
                    """INSERT INTO doc_sequences
                            (doc_type, company_id, year, last_seq, updated_at)
                        VALUES (%s, %s, %s, %s, NOW())
                        ON CONFLICT (doc_type, company_id, year) DO UPDATE
                          SET last_seq = EXCLUDED.last_seq,
                              updated_at = NOW()""",
                    rows,
                )

            cur.execute("ALTER TABLE quotation_item_requests ENABLE TRIGGER trg_qir_lock_parent")

            print(f"\n>> inserted {n_inserted} 2024 quotations "
                  f"({n_versions} version-chained, {n_drafts} as draft)")

            cur.execute("""
                SELECT cc.name, COUNT(q.id) AS n,
                       COALESCE(SUM(q.total),0)::text AS total_rp
                FROM company_client cc
                LEFT JOIN quotations q
                       ON q.company_client_id = cc.id
                      AND EXTRACT(YEAR FROM q.created_at AT TIME ZONE 'Asia/Jakarta') = 2024
                GROUP BY cc.id, cc.name
                ORDER BY cc.id
            """)
            print("\n=== Per-customer 2024 reconciliation ===")
            for name, n, t in cur.fetchall():
                print(f"  [{n or 0:4}]  Rp {t or '0':>20}  {name}")

            cur.execute("SELECT COUNT(*) FROM quotations")
            print(f"\n>> total quotations in DB now: {cur.fetchone()[0]}")
            cur.execute("SELECT COUNT(*) FROM quotation_items")
            print(f">> total quotation_items in DB now: {cur.fetchone()[0]}")

            if args.dry_run:
                print("\n[dry-run] rolling back")
                conn.rollback()
            else:
                conn.commit()
                print("\n[committed]")


if __name__ == "__main__":
    main()
