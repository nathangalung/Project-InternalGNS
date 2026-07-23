"""Additive 2025 loader. Appends to the live DB without TRUNCATE.

Reads staged.json (assumed to contain only 2025 files), inserts the 5 new
customers (IDs 11..15) if missing, dedups items/vendors/contacts/
vendor_products against current DB state, then inserts every quotation in
chronological order. Q-numbers are regenerated Python-side from each file's
historical 2025 date (so a January 2025 file gets `/I/2025`). After all
inserts, doc_sequences is upserted for (Q, company_id, 2025) so the API's
fn_next_doc_no continues from the right last_seq going forward.

Run:  uv run load_2025.py [--dry-run]
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

# Reuse helpers from the 2026 loader so behaviour stays in sync.
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
from unit_map import canonical_unit


STAGED_FILE = Path(__file__).parent / "staged.json"
DSN = os.environ.get("DATABASE_URL", DEFAULT_DSN)

# IDs of customers introduced specifically for 2025 data.
NEW_CUSTOMER_IDS = {11, 12, 13, 14, 15}

CUSTOMER_NAME_TO_ID: dict[str, int] = {c[2]: c[0] for c in CUSTOMERS}
CUSTOMER_NUMBER_BY_ID: dict[int, str] = {c[0]: c[1] for c in CUSTOMERS}


# ---------------------------------------------------------------------------
def load_staged() -> list[dict]:
    raw = json.loads(STAGED_FILE.read_text(encoding="utf-8"))
    return raw["parsed"]


def ensure_new_customers(cur):
    """Insert customers 4011..4015 if they don't already exist."""
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


def fetch_unit_map(cur) -> dict[str, int]:
    cur.execute("SELECT id, code FROM units")
    return {row[1]: row[0] for row in cur.fetchall()}


def load_existing_items(cur) -> dict[str, int]:
    """dedup_key (impa: or name:) → items.id."""
    cur.execute("SELECT id, COALESCE(impa_code, ''), name FROM items")
    out: dict[str, int] = {}
    for iid, impa, name in cur.fetchall():
        out[item_dedup_key(impa or None, name)] = iid
    return out


def load_existing_vendors(cur) -> dict[str, int]:
    """normalized vendor name → vendors.id."""
    cur.execute("SELECT id, name FROM vendors")
    return {norm_name(name): vid for vid, name in cur.fetchall()}


def load_existing_vendor_products(cur) -> dict[tuple[int, int], int]:
    """(vendor_id, item_id) → vendor_products.id."""
    cur.execute("SELECT id, vendor_id, item_id FROM vendor_products")
    return {(v, i): vp for vp, v, i in cur.fetchall()}


def load_existing_contacts(cur) -> tuple[dict[tuple[int, str], int], set[str]]:
    """((company_id, norm_name) → id, set of lower-cased emails)."""
    cur.execute("SELECT id, company_id, name, email FROM company_contacts")
    by_key: dict[tuple[int, str], int] = {}
    emails: set[str] = set()
    for cid, comp, name, email in cur.fetchall():
        by_key[(comp, norm_name(name))] = cid
        if email:
            emails.add(email.lower())
    return by_key, emails


def insert_new_items(cur, parsed, unit_id_by_code, items_id_map):
    """Insert items not already present; update items_id_map in place."""
    new_count = 0
    for r in parsed:
        for it in r["items"]:
            name = it.get("offer_desc") or it.get("nama_asli") or it.get("request_desc")
            if not name:
                continue
            key = item_dedup_key(it.get("impa"), name)
            if key in items_id_map:
                continue
            unit_code = canonical_unit(it.get("unit"))
            cur.execute(
                """INSERT INTO items (name, impa_code, default_unit_id,
                                       created_by, updated_by)
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING id""",
                (
                    truncate_to(name, 500),
                    truncate_to(it.get("impa"), 20),
                    unit_id_by_code.get(unit_code) if unit_code else None,
                    SUPERADMIN_ID, SUPERADMIN_ID,
                ),
            )
            items_id_map[key] = cur.fetchone()[0]
            new_count += 1
    return new_count


def insert_new_vendors(cur, parsed, vendor_id_map):
    """Insert vendors not already present; update vendor_id_map in place."""
    new_count = 0
    for r in parsed:
        for it in r["items"]:
            v = it.get("vendor_name")
            if not v:
                continue
            v_clean = " / ".join(p.strip() for p in re.split(r"[\n,]", v) if p.strip())
            if not v_clean:
                continue
            key = norm_name(v_clean)
            if key in vendor_id_map:
                continue
            cur.execute(
                """INSERT INTO vendors (name, created_by, updated_by)
                    VALUES (%s, %s, %s)
                    RETURNING id""",
                (truncate_to(v_clean, 255), SUPERADMIN_ID, SUPERADMIN_ID),
            )
            vendor_id_map[key] = cur.fetchone()[0]
            new_count += 1
    return new_count


def insert_new_vendor_products(cur, parsed, vendor_id_map, items_id_map, vp_lookup):
    """Insert vendor_products for new (vendor_id, item_id) pairs."""
    new_count = 0
    for r in parsed:
        for it in r["items"]:
            v_raw = it.get("vendor_name")
            if not v_raw:
                continue
            v_clean = " / ".join(p.strip() for p in re.split(r"[\n,]", v_raw) if p.strip())
            v_id = vendor_id_map.get(norm_name(v_clean))
            if not v_id:
                continue
            name = it.get("offer_desc") or it.get("nama_asli") or it.get("request_desc")
            if not name:
                continue
            i_id = items_id_map.get(item_dedup_key(it.get("impa"), name))
            if not i_id:
                continue
            if (v_id, i_id) in vp_lookup:
                continue
            cost = it.get("cost_price")
            if cost is None or cost < 0:
                cost = 0
            cur.execute(
                """INSERT INTO vendor_products
                        (vendor_id, item_id, cost_price, created_by, updated_by)
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING id""",
                (v_id, i_id, cost, SUPERADMIN_ID, SUPERADMIN_ID),
            )
            vp_lookup[(v_id, i_id)] = cur.fetchone()[0]
            new_count += 1
    return new_count


def insert_new_contacts(cur, parsed, contacts_id_map, used_emails):
    """Insert contacts deduped by (company_id, norm_name); skip emails already
    used to satisfy idx_company_contacts_email UNIQUE."""
    new_count = 0
    for r in parsed:
        cust_id = CUSTOMER_NAME_TO_ID[r["customer_name"]]
        name = r["contact_name"]
        if not name:
            continue
        key = (cust_id, norm_name(name))
        if key in contacts_id_map:
            continue
        email = truncate_to(r.get("contact_email"), 255)
        if email:
            ek = email.lower()
            if ek in used_emails:
                email = None
            else:
                used_emails.add(ek)
        cur.execute(
            """INSERT INTO company_contacts
                    (company_id, name, email, phone, country_code,
                     created_by, updated_by)
                VALUES (%s, %s, %s, %s, 'IDN', %s, %s)
                RETURNING id""",
            (
                cust_id, truncate_to(name, 255), email,
                normalize_phone(r.get("contact_phone_raw")),
                SUPERADMIN_ID, SUPERADMIN_ID,
            ),
        )
        contacts_id_map[key] = cur.fetchone()[0]
        new_count += 1
    return new_count


def build_lines(file_data, items_id_map, vendor_id_map, vp_lookup, unit_id_by_code):
    """Return ordered line items for a single quotation."""
    out: list[dict] = []
    for line, it in enumerate(file_data["items"], start=1):
        qty = it.get("qty") or 0
        sell = it.get("selling_price")
        cost = it.get("cost_price")
        if qty <= 0 and (sell is None or sell <= 0):
            continue
        if sell is None:
            sell = 0.0
        # Defensive: quotation_items.profit_pct is NUMERIC(7,4) (max ~999.99).
        # If (sell - cost) / cost would overflow that, the cost is almost
        # certainly a data-entry typo (off by orders of magnitude). Drop it
        # so profit_pct ends up NULL via NULLIF rather than failing INSERT.
        if cost is not None and cost > 0 and sell > 0 and sell / cost > 999:
            cost = None
        unit_code = canonical_unit(it.get("unit"))
        unit_id = unit_id_by_code.get(unit_code) if unit_code else None
        # Canonical OFFER name precedence: explicit OFFER column (IMPA layout)
        # > Col D description > Col M nama_asli fallback. Mirrors generate_seed.py.
        name = it.get("offer_desc") or it.get("request_desc") or it.get("nama_asli")
        item_id = items_id_map.get(item_dedup_key(it.get("impa"), name)) if name else None
        vp_id = None
        if it.get("vendor_name"):
            v_clean = " / ".join(p.strip() for p in re.split(r"[\n,]", it["vendor_name"]) if p.strip())
            v_id = vendor_id_map.get(norm_name(v_clean))
            if v_id and item_id:
                vp_id = vp_lookup.get((v_id, item_id))
        # Textual substitution flag drives qir.match_status downstream.
        nama_asli = (it.get("nama_asli") or "").strip()
        offer_canon = (name or "").strip()
        is_substituted = bool(nama_asli) and bool(offer_canon) and nama_asli != offer_canon
        out.append({
            "line_number": line,
            "item_type": "product",
            "requested_item_id": item_id,
            "requested_impa": truncate_to(it.get("impa"), 20),
            # requested_name = client's ORIGINAL request (Col M "Nama Asli barang"),
            # falling back to Col D / canonical name only when nama_asli is blank.
            "requested_name": truncate_to(it.get("nama_asli") or it.get("request_desc") or name or "", 5000),
            "offered_item_id": item_id,
            "vendor_product_id": vp_id,
            "qty": qty,
            "unit_id": unit_id,
            "selling_price": sell,
            "cost_price": cost,
            "discount_pct": file_data.get("discount_pct") or 0,
            "_is_substituted": is_substituted,
        })
    return out


def insert_quotation(cur, file_data, company_id, contact_id, items,
                     version, parent_id, seq, year, month, status):
    new_qno = py_next_doc_no("Q", CUSTOMER_NUMBER_BY_ID[company_id], seq, year, month)

    discount = file_data.get("discount_pct") or 0
    total_produk = sum(i["qty"] * i["selling_price"] for i in items)
    total_discount = total_produk * (discount / 100)
    total = total_produk

    cur.execute("SELECT name FROM company_client WHERE id = %s", (company_id,))
    cust_name = cur.fetchone()[0]
    contact_name = None
    if contact_id is not None:
        cur.execute("SELECT name FROM company_contacts WHERE id = %s", (contact_id,))
        row = cur.fetchone()
        if row:
            contact_name = row[0]

    date_iso = file_data.get("date_iso")
    created_at_expr = "(%s::date + INTERVAL '9 hours')" if date_iso else "NOW()"
    created_at_param = (date_iso,) if date_iso else ()

    notes = (
        f"Imported from Excel\n"
        f"Original Q-no: {file_data.get('raw_qno_norm')}\n"
        f"File: {file_data.get('file')}"
    )

    your_ref = file_data.get("your_ref")
    if your_ref and re.match(
        r"^by\s+(email|wa|whatsapp|telp|fax)\.?$", your_ref.strip(), re.IGNORECASE
    ):
        your_ref = None

    sql = f"""
        INSERT INTO quotations (
            quotation_no, version, parent_id, company_client_id, company_client_name,
            contact_id, contact_name, client_ref_no, vessel_name, status,
            payment_terms, validity_days, discount_pct,
            total_produk, total, total_discount,
            notes, created_at, created_by, updated_by
        ) VALUES (
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, NULL, %s,
            %s, %s, %s,
            %s, {created_at_expr} AT TIME ZONE 'Asia/Jakarta', %s, %s
        )
        RETURNING id
    """
    params = (
        new_qno, version, parent_id, company_id, cust_name,
        contact_id, contact_name, your_ref, file_data.get("vessel_name"), status,
        truncate_to(file_data.get("payment_terms"), 100),
        discount,
        total_produk, total, total_discount,
        notes, *created_at_param, SUPERADMIN_ID, SUPERADMIN_ID,
    )
    cur.execute(sql, params)
    qid = cur.fetchone()[0]

    # Insert items + paired qir row. Mirrors generate_seed.py historical 1:1.
    # main() in load_2025/load_2024 disables trg_qir_lock_parent for the bulk
    # window so 'sent'-status quotations can still get their qir backfill.
    for i in items:
        cur.execute(
            """INSERT INTO quotation_items (
                quotation_id, line_number, item_type,
                requested_item_id, requested_impa, requested_name,
                offered_item_id, vendor_product_id,
                qty, unit_id, selling_price, cost_price, discount_pct,
                update_vendor_price, created_by, updated_by
            ) VALUES (
                %s, %s, %s,
                %s, %s, %s,
                %s, %s,
                %s, %s, %s, %s, %s,
                FALSE, %s, %s
            ) RETURNING id""",
            (
                qid, i["line_number"], i["item_type"],
                i["requested_item_id"], i["requested_impa"], i["requested_name"],
                i["offered_item_id"], i["vendor_product_id"],
                i["qty"], i["unit_id"], i["selling_price"], i["cost_price"],
                i["discount_pct"],
                SUPERADMIN_ID, SUPERADMIN_ID,
            ),
        )
        qi_id = cur.fetchone()[0]

        if i["offered_item_id"] is None:
            qir_status, qir_note = "unavailable", "Loaded from Excel; offered item not in master catalog at load time"
        elif i.get("_is_substituted"):
            qir_status, qir_note = "substituted", "Loaded from Excel; offer text differs from client request text"
        else:
            qir_status, qir_note = "matched", "Loaded from Excel"

        cur.execute(
            """INSERT INTO quotation_item_requests (
                quotation_id, line_no, request_text, request_impa, requested_qty,
                matched_item_id, match_status, source_type, notes,
                reviewed_by, reviewed_at, created_by, updated_by
            ) VALUES (
                %s, %s, %s, %s, %s,
                %s, %s, 'import', %s,
                %s, NOW(), %s, %s
            ) RETURNING id""",
            (
                qid, i["line_number"], i["requested_name"], i["requested_impa"],
                i["qty"], i["offered_item_id"], qir_status, qir_note,
                SUPERADMIN_ID, SUPERADMIN_ID, SUPERADMIN_ID,
            ),
        )
        qir_id = cur.fetchone()[0]

        cur.execute(
            "UPDATE quotation_items SET request_id = %s WHERE id = %s",
            (qir_id, qi_id),
        )
    return qid


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true",
                        help="Run inside a tx then ROLLBACK")
    args = parser.parse_args()

    parsed = load_staged()
    # Defensive: this script is for 2025 data only.
    parsed = [r for r in parsed
              if r.get("date_iso") and r["date_iso"].startswith("2025")]
    print(f"Loaded {len(parsed)} files for year 2025")

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
            # blocks qir writes for non-draft quotation status. Most files load as
            # 'sent' — disable trigger for the bulk window. DDL is transactional;
            # rollback restores the trigger.
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
                        d = datetime(2025, 1, 1)
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

            print(f"\n>> inserted {n_inserted} 2025 quotations "
                  f"({n_versions} version-chained, {n_drafts} as draft)")

            cur.execute("""
                SELECT cc.name, COUNT(q.id) AS n,
                       COALESCE(SUM(q.total),0)::text AS total_rp
                FROM company_client cc
                LEFT JOIN quotations q
                       ON q.company_client_id = cc.id
                      AND EXTRACT(YEAR FROM q.created_at AT TIME ZONE 'Asia/Jakarta') = 2025
                GROUP BY cc.id, cc.name
                ORDER BY cc.id
            """)
            print("\n=== Per-customer 2025 reconciliation ===")
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
