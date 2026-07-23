"""Load staged.json into the database.

Wipes transactional tables (preserves users, units, countries), seeds the 10
real customers + their contacts, builds an item / vendor / vendor_product
catalog from the historical line items, then inserts every quotation in
chronological order. Duplicates within a group of files sharing the same
original Q-number are linked via parent_id as version chains.

Run: uv run load.py [--dry-run]

Connects via DATABASE_URL or the default dev DSN.
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

from unit_map import canonical_unit


STAGED_FILE = Path(__file__).parent / "staged.json"

DEFAULT_DSN = "postgres://gns_app:gns_app@localhost:5432/gns_quotation?sslmode=disable"
DSN = os.environ.get("DATABASE_URL", DEFAULT_DSN)
SUPERADMIN_ID = 1

# Customer master (must match parse.py CANONICAL_CUSTOMERS).
CUSTOMERS = [
    (1, "4001", "PT. IMC Ship Management"),
    (2, "4002", "PT. Sentra Makmur Lines"),
    (3, "4003", "PT. Pelita Global Logistik"),
    (4, "4004", "PT. Karunia Aman Sentosa"),
    (5, "4005", "PT. Karunia Aman Selalu"),
    (6, "4006", "PT. Niterra Mobility Indonesia"),
    (7, "4007", "PT. Mitrabahtera Segara Sejati"),
    (8, "4008", "PT. Aman Maritim Nusantara"),
    (9, "4009", "PT. Kasen Maritim Logistik"),
    (10, "4010", "PT. Adamaris Shipping Indonesia"),
    (11, "4011", "PT. Solusi Pelayaran Nusantara"),
    (12, "4012", "PT. Transcoal Pasific"),
    (13, "4013", "PT. Indobaruna Bulk Transport"),
    (14, "4014", "PT. Tara Jaya Cemerlang"),
    (15, "4015", "PT. Karunia Aman Sejahtera"),
    (16, "4016", "PT. Isna Agung Permata"),
    (17, "4017", "PT. Lumoso Pratama Line"),
    (18, "4018", "PT. Indoglas Jaya"),
]
CUSTOMER_NAME_TO_ID: dict[str, int] = {c[2]: c[0] for c in CUSTOMERS}

# Roman numerals for fn_next_doc_no Python-side reproduction.
_ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"]


def py_next_doc_no(prefix: str, company_no: str, seq: int, year: int, month: int) -> str:
    """Mirror schema's fn_next_doc_no but use historical year/month from the
    file (not NOW()). Format: {prefix}-{YY}{co_no}{seq}/GNS/{Roman}/{YYYY}.
    """
    yy = f"{year % 100:02d}"
    return f"{prefix}-{yy}{company_no}{seq}/GNS/{_ROMAN[month - 1]}/{year}"


def normalize_phone(raw: str | None) -> str | None:
    """Strip non-digits; require 9..12 digits to satisfy CHECK constraint.

    Returns None if the cleaned value is empty or out of range.
    """
    if not raw:
        return None
    digits = re.sub(r"\D", "", str(raw))
    if not digits:
        return None
    # Strip leading country prefix if present (e.g. 62 / 0)
    if digits.startswith("62") and len(digits) > 9:
        digits = digits[2:]
    if digits.startswith("0"):
        digits = digits.lstrip("0")
    if 9 <= len(digits) <= 12:
        return digits
    return None


_HONORIFIC_RE = re.compile(
    r"^(bp\.?|bpk\.?|bapak|ibu|sdr\.?|sdri\.?|mr\.?|mrs\.?|ms\.?)\s+",
    re.IGNORECASE,
)


def norm_name(s: str | None) -> str:
    """Lowercase + collapse whitespace + strip Indonesian honorifics.

    Mirrors generate_seed.py to keep contact dedup keys consistent.
    """
    if not s:
        return ""
    out = re.sub(r"\s+", " ", s.strip().lower())
    out = _HONORIFIC_RE.sub("", out)
    return out


def truncate_to(value: str | None, n: int) -> str | None:
    if value is None:
        return None
    return value[:n]


# ---------------------------------------------------------------------------
# Master-data builders. Returns dicts ready for INSERT.
# ---------------------------------------------------------------------------
def build_contacts(parsed: list[dict]) -> dict[tuple[int, str], dict]:
    """Dedup contacts by (company_id, normalized contact_name).

    Each value carries the first email/phone observed for that contact.
    Email is also globally deduped: if an email already appears in an earlier
    contact (any company), drop it from later entries to satisfy the
    `idx_company_contacts_email` UNIQUE constraint.
    """
    out: dict[tuple[int, str], dict] = {}
    seen_emails: set[str] = set()
    for r in parsed:
        cust_id = CUSTOMER_NAME_TO_ID[r["customer_name"]]
        name = r["contact_name"]
        if not name:
            continue
        key = (cust_id, norm_name(name))
        if key in out:
            continue
        email = truncate_to(r.get("contact_email"), 255)
        if email:
            email_key = email.lower()
            if email_key in seen_emails:
                email = None  # later contacts share the email; keep contact, drop email
            else:
                seen_emails.add(email_key)
        out[key] = {
            "company_id": cust_id,
            "name": truncate_to(name, 255),
            "email": email,
            "phone": normalize_phone(r.get("contact_phone_raw")),
            "title": None,
        }
    return out


def item_dedup_key(impa: str | None, name: str) -> str:
    """Dedup key: IMPA when present, else normalized name."""
    impa = (impa or "").strip()
    if impa:
        return f"impa:{impa}"
    return f"name:{norm_name(name)}"


def build_items_master(parsed: list[dict], unit_id_by_code: dict[str, int]) -> dict[str, dict]:
    """Aggregate every distinct item across all quotations."""
    out: dict[str, dict] = {}
    for r in parsed:
        for it in r["items"]:
            name = it.get("offer_desc") or it.get("nama_asli") or it.get("request_desc")
            if not name:
                continue
            key = item_dedup_key(it.get("impa"), name)
            if key in out:
                continue
            unit_code = canonical_unit(it.get("unit"))
            out[key] = {
                "name": truncate_to(name, 500),
                "impa_code": truncate_to(it.get("impa"), 20),
                "default_unit_id": unit_id_by_code.get(unit_code) if unit_code else None,
                "description": None,
            }
    return out


def build_vendors_master(parsed: list[dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for r in parsed:
        for it in r["items"]:
            v = it.get("vendor_name")
            if not v:
                continue
            # Strip newlines (some files have multi-vendor in one cell)
            v_clean = " / ".join(p.strip() for p in re.split(r"[\n,]", v) if p.strip())
            if not v_clean:
                continue
            key = norm_name(v_clean)
            if key not in out:
                out[key] = {
                    "name": truncate_to(v_clean, 255),
                    "location": None,
                    "contact_info": None,
                }
    return out


def build_vendor_products(
    parsed: list[dict],
    vendor_key_to_id: dict[str, int],
    item_key_to_id: dict[str, int],
) -> dict[tuple[int, int], dict]:
    """Pair (vendor_id, item_id) → cost_price; later writes win."""
    out: dict[tuple[int, int], dict] = {}
    for r in parsed:
        for it in r["items"]:
            v_raw = it.get("vendor_name")
            if not v_raw:
                continue
            v_clean = " / ".join(p.strip() for p in re.split(r"[\n,]", v_raw) if p.strip())
            v_key = norm_name(v_clean)
            v_id = vendor_key_to_id.get(v_key)
            if not v_id:
                continue
            name = it.get("offer_desc") or it.get("nama_asli") or it.get("request_desc")
            if not name:
                continue
            i_key = item_dedup_key(it.get("impa"), name)
            i_id = item_key_to_id.get(i_key)
            if not i_id:
                continue
            cost = it.get("cost_price")
            if cost is None:
                continue
            # CHECK cost_price >= 0
            if cost < 0:
                cost = 0
            out[(v_id, i_id)] = {
                "vendor_id": v_id,
                "item_id": i_id,
                "vendor_sku": None,
                "cost_price": cost,
            }
    return out


# ---------------------------------------------------------------------------
# Loader
# ---------------------------------------------------------------------------
def load_staged() -> list[dict]:
    raw = json.loads(STAGED_FILE.read_text(encoding="utf-8"))
    return raw["parsed"]


def reset_db(cur):
    print(">> resetting transactional tables")
    cur.execute("""
        TRUNCATE TABLE
            invoice_items, invoices,
            purchase_order_items, purchase_orders,
            quotation_status_history, quotation_item_requests, quotation_items, quotations,
            item_request_matches,
            vendor_products, items,
            company_contacts, company_client,
            vendors,
            doc_sequences
        RESTART IDENTITY CASCADE
    """)
    cur.execute("DELETE FROM users WHERE id <> %s", (SUPERADMIN_ID,))


def fetch_unit_map(cur) -> dict[str, int]:
    cur.execute("SELECT id, code FROM units")
    return {row[1]: row[0] for row in cur.fetchall()}


def insert_customers(cur):
    print(">> inserting customers")
    rows = [
        (cid, num, name, "IDN", SUPERADMIN_ID, SUPERADMIN_ID)
        for (cid, num, name) in CUSTOMERS
    ]
    cur.executemany(
        """INSERT INTO company_client
                (id, number, name, country_code, created_by, updated_by)
            VALUES (%s, %s, %s, %s, %s, %s)""",
        rows,
    )
    cur.execute(
        "SELECT setval('company_client_id_seq', GREATEST((SELECT MAX(id) FROM company_client), 1))"
    )


def insert_contacts(cur, contacts) -> dict[tuple[int, str], int]:
    print(f">> inserting {len(contacts)} contacts")
    out: dict[tuple[int, str], int] = {}
    for key, c in contacts.items():
        cur.execute(
            """INSERT INTO company_contacts
                    (company_id, name, email, phone, title, country_code,
                     created_by, updated_by)
                VALUES (%s, %s, %s, %s, %s, 'IDN', %s, %s)
                RETURNING id""",
            (c["company_id"], c["name"], c["email"], c["phone"], c["title"],
             SUPERADMIN_ID, SUPERADMIN_ID),
        )
        out[key] = cur.fetchone()[0]
    return out


def insert_items(cur, items_master) -> dict[str, int]:
    print(f">> inserting {len(items_master)} items")
    out: dict[str, int] = {}
    for key, it in items_master.items():
        cur.execute(
            """INSERT INTO items (name, impa_code, default_unit_id, description,
                                  created_by, updated_by)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id""",
            (it["name"], it["impa_code"], it["default_unit_id"], it["description"],
             SUPERADMIN_ID, SUPERADMIN_ID),
        )
        out[key] = cur.fetchone()[0]
    return out


def insert_vendors(cur, vendors_master) -> dict[str, int]:
    print(f">> inserting {len(vendors_master)} vendors")
    out: dict[str, int] = {}
    for key, v in vendors_master.items():
        cur.execute(
            """INSERT INTO vendors (name, location, contact_info,
                                     created_by, updated_by)
                VALUES (%s, %s, %s::jsonb, %s, %s)
                RETURNING id""",
            (v["name"], v["location"],
             json.dumps(v["contact_info"]) if v["contact_info"] else None,
             SUPERADMIN_ID, SUPERADMIN_ID),
        )
        out[key] = cur.fetchone()[0]
    return out


def insert_vendor_products(cur, vp_map):
    print(f">> inserting {len(vp_map)} vendor_products")
    rows = [
        (vp["vendor_id"], vp["item_id"], vp["vendor_sku"], vp["cost_price"],
         SUPERADMIN_ID, SUPERADMIN_ID)
        for vp in vp_map.values()
    ]
    cur.executemany(
        """INSERT INTO vendor_products
                (vendor_id, item_id, vendor_sku, cost_price,
                 created_by, updated_by)
            VALUES (%s, %s, %s, %s, %s, %s)""",
        rows,
    )


def build_quotation_items(
    file_data: dict,
    item_key_to_id: dict[str, int],
    vp_lookup: dict[tuple[int, int], int],
    vendor_key_to_id: dict[str, int],
    unit_id_by_code: dict[str, int],
) -> list[dict]:
    """Return list of items for a single quotation, ready for INSERT.

    Skips item rows with no qty AND no selling price.
    """
    out: list[dict] = []
    for line, it in enumerate(file_data["items"], start=1):
        qty = it.get("qty") or 0
        sell = it.get("selling_price")
        cost = it.get("cost_price")
        if qty <= 0 and (sell is None or sell <= 0):
            # Skip placeholder rows (e.g. cancelled item with 0 prices)
            continue
        if sell is None:
            sell = 0.0
        unit_code = canonical_unit(it.get("unit"))
        unit_id = unit_id_by_code.get(unit_code) if unit_code else None
        # Item linkage. Canonical OFFER name precedence: explicit OFFER column
        # (IMPA layout) > Col D description > Col M nama_asli fallback. Mirrors
        # generate_seed.py so the live-load and seed-gen paths agree.
        name = it.get("offer_desc") or it.get("request_desc") or it.get("nama_asli")
        item_id = item_key_to_id.get(item_dedup_key(it.get("impa"), name)) if name else None

        # Vendor product
        vp_id = None
        if it.get("vendor_name"):
            v_clean = " / ".join(
                p.strip() for p in re.split(r"[\n,]", it["vendor_name"]) if p.strip()
            )
            v_id = vendor_key_to_id.get(norm_name(v_clean))
            if v_id and item_id:
                vp_id = vp_lookup.get((v_id, item_id))

        # Textual substitution flag: drives qir.match_status downstream.
        nama_asli = (it.get("nama_asli") or "").strip()
        offer_canon = (name or "").strip()
        is_substituted = bool(nama_asli) and bool(offer_canon) and nama_asli != offer_canon

        out.append({
            "line_number": line,
            "item_type": "product",
            "requested_item_id": item_id,
            "requested_impa": truncate_to(it.get("impa"), 20),
            # requested_name = client's ORIGINAL request text (Col M "Nama Asli barang").
            # Falls back to Col D / canonical name only when nama_asli is blank.
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


def insert_quotation(
    cur,
    file_data: dict,
    company_id: int,
    company_no: str,
    contact_id: int | None,
    items: list[dict],
    version: int,
    parent_id: int | None,
    seq: int,
    year: int,
    month: int,
    status: str = "sent",
) -> int:
    """Insert one quotation header + items. Returns new quotation id.

    Bypasses fn_create_quotation so we can set parent_id/version/created_at
    and our own pre-calculated totals. Also bypasses the SQL `fn_next_doc_no`
    because that uses NOW() for the year/month token; we instead generate
    the doc number Python-side using the file's historical date so a 2025
    file gets a 2025 Q-number and the right Roman month token.

    `status` defaults to 'sent' (historical = already shipped); pass 'draft'
    for files that look like incomplete drafts (e.g. all selling_prices = 0).
    """
    new_qno = py_next_doc_no("Q", company_no, seq, year, month)

    discount = file_data.get("discount_pct") or 0
    total_produk = sum(i["qty"] * i["selling_price"] for i in items)
    total_discount = total_produk * (discount / 100)
    total = total_produk

    # Snapshot company + contact name from current master
    cur.execute("SELECT name FROM company_client WHERE id = %s", (company_id,))
    cust_name = cur.fetchone()[0]
    contact_name = None
    if contact_id is not None:
        cur.execute("SELECT name FROM company_contacts WHERE id = %s", (contact_id,))
        row = cur.fetchone()
        if row:
            contact_name = row[0]

    # created_at = file date at 09:00 Jakarta. Parentheses needed because
    # AT TIME ZONE binds tighter than + in PG.
    date_iso = file_data.get("date_iso")
    created_at_expr = "(%s::date + INTERVAL '9 hours')" if date_iso else "NOW()"
    created_at_param = (date_iso,) if date_iso else ()

    # Build NOTES with original Q-number for traceability
    notes = (
        f"Imported from Excel\n"
        f"Original Q-no: {file_data.get('raw_qno_norm')}\n"
        f"File: {file_data.get('file')}"
    )

    # client_ref_no: drop placeholders like "By Email" / "By WA"
    your_ref = file_data.get("your_ref")
    if your_ref and re.match(r"^by\s+(email|wa|whatsapp|telp|fax)\.?$",
                              your_ref.strip(), re.IGNORECASE):
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

    # Insert items + paired qir row. Mirrors generate_seed.py behaviour: 1 qir
    # per qi (historical 1:1). The trg_qir_lock_parent trigger blocks qir writes
    # when parent quotation status is not draft/revision — main() disables the
    # trigger session-wide for the load duration.
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

        # qir match_status: 'unavailable' when no master item, 'substituted' on
        # textual differ, 'matched' otherwise.
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
                        help="Open transaction, run inserts, then ROLLBACK")
    args = parser.parse_args()

    parsed = load_staged()
    print(f"Loaded {len(parsed)} files from staged.json")

    # Sort all by date ASC for chronological insertion (so fn_next_doc_no
    # sequence numbers grow monotonically with date per company).
    parsed.sort(key=lambda r: (r["date_iso"] or "9999-99-99",
                               r["raw_qno_norm"] or ""))

    # Group by original qno_norm for version chain
    groups: dict[str, list[dict]] = defaultdict(list)
    for r in parsed:
        key = r["raw_qno_norm"] or r["file"]
        groups[key].append(r)

    print(f"  → {len(groups)} unique qno groups; "
          f"{sum(1 for g in groups.values() if len(g) > 1)} have duplicates")

    # Connect
    print(f"\nConnecting to: {DSN}")
    with psycopg.connect(DSN, autocommit=False) as conn:
        with conn.cursor() as cur:
            # 1. Reset
            reset_db(cur)

            # 2. Customers
            insert_customers(cur)

            # 3. Master fetches
            unit_id_by_code = fetch_unit_map(cur)
            print(f">> {len(unit_id_by_code)} unit codes loaded")

            # 4. Build master from parsed data
            contacts = build_contacts(parsed)
            items_master = build_items_master(parsed, unit_id_by_code)
            vendors_master = build_vendors_master(parsed)

            contact_id_map = insert_contacts(cur, contacts)
            item_id_map = insert_items(cur, items_master)
            vendor_id_map = insert_vendors(cur, vendors_master)

            vp_map = build_vendor_products(parsed, vendor_id_map, item_id_map)
            insert_vendor_products(cur, vp_map)

            # 5. Build (vendor_id, item_id) → vendor_product_id lookup
            cur.execute("SELECT id, vendor_id, item_id FROM vendor_products")
            vp_lookup = {(r[1], r[2]): r[0] for r in cur.fetchall()}

            # 6. Insert quotations chronologically.
            # Q-numbers are regenerated per (company, year) using the file's
            # historical date — a 2025 file keeps its 2025 year token; a 2026
            # file keeps 2026. seq grows monotonically with date per
            # (company, year). doc_sequences is repopulated at the end.
            #
            # qir lock trigger: insert_quotation writes 1 qir row per qi row,
            # but the trigger blocks qir writes for quotations whose status is
            # not draft/revision. Most files load as 'sent', so we disable the
            # trigger for the bulk-load window and re-enable at the end. DDL
            # is transactional in PG — rollback restores the trigger.
            cur.execute("ALTER TABLE quotation_item_requests DISABLE TRIGGER trg_qir_lock_parent")
            cust_no_by_id: dict[int, str] = {c[0]: c[1] for c in CUSTOMERS}
            seq_counter: dict[tuple[int, int], int] = defaultdict(int)
            n_inserted = 0
            n_versions = 0
            n_drafts = 0
            for qkey, group in groups.items():
                # Sort group by date ASC (oldest = parent v1)
                group.sort(key=lambda r: r["date_iso"] or "9999-99-99")
                prev_id: int | None = None
                for v_idx, file_data in enumerate(group, start=1):
                    cust_id = CUSTOMER_NAME_TO_ID[file_data["customer_name"]]
                    contact_id = None
                    if file_data.get("contact_name"):
                        contact_id = contact_id_map.get(
                            (cust_id, norm_name(file_data["contact_name"]))
                        )
                    items = build_quotation_items(
                        file_data, item_id_map, vp_lookup, vendor_id_map,
                        unit_id_by_code,
                    )
                    if not items:
                        # Skip files with no parseable items
                        continue
                    # Files where every line has a non-positive selling price
                    # are treated as drafts (Excel pricing not yet entered);
                    # status='draft' so users can finish them in the UI.
                    is_draft = not any((it["selling_price"] or 0) > 0 for it in items)
                    status = "draft" if is_draft else "sent"
                    if is_draft:
                        n_drafts += 1
                        print(f"  [draft] {file_data.get('file')}")

                    # Resolve year/month from the file's date (fallback today).
                    date_iso = file_data.get("date_iso")
                    try:
                        d = datetime.strptime(date_iso, "%Y-%m-%d") if date_iso else None
                    except (ValueError, TypeError):
                        d = None
                    if d is None:
                        d = datetime.now()
                    year, month = d.year, d.month

                    seq_key = (cust_id, year)
                    seq_counter[seq_key] += 1

                    qid = insert_quotation(
                        cur, file_data, cust_id, cust_no_by_id[cust_id],
                        contact_id, items,
                        version=v_idx, parent_id=prev_id,
                        seq=seq_counter[seq_key], year=year, month=month,
                        status=status,
                    )
                    prev_id = qid
                    n_inserted += 1
                    if v_idx > 1:
                        n_versions += 1

            # Persist doc_sequences so the API's fn_next_doc_no continues
            # from the right last_seq for each (company, year).
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

            # Re-enable qir lock trigger now that bulk insert is done.
            cur.execute("ALTER TABLE quotation_item_requests ENABLE TRIGGER trg_qir_lock_parent")

            print(f"\n>> inserted {n_inserted} quotations "
                  f"({n_versions} version-chained, {n_drafts} as draft)")

            # 7. Reconciliation report
            cur.execute("""
                SELECT cc.name, COUNT(q.id) AS qcount,
                       SUM(q.total)::text AS total_rp
                FROM company_client cc
                LEFT JOIN quotations q ON q.company_client_id = cc.id
                GROUP BY cc.id, cc.name
                ORDER BY cc.id
            """)
            print("\n=== Per-customer reconciliation ===")
            for name, n, t in cur.fetchall():
                print(f"  [{n or 0:3}]  Rp {t or '0':>20}  {name}")

            cur.execute("SELECT COUNT(*) FROM quotation_items")
            n_items = cur.fetchone()[0]
            print(f"\n>> {n_items} quotation_items rows")

            if args.dry_run:
                print("\n[dry-run] rolling back")
                conn.rollback()
            else:
                conn.commit()
                print("\n[committed]")


if __name__ == "__main__":
    main()
