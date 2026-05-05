"""Generate a deterministic SQL seed file from staged.json.

Mirrors load.py's logic but writes a single .sql file instead of executing
against a live DB. Output: apps/api/db/seeds/03_historical.sql.

Covers all 3 historical years (2024 + 2025 + 2026) in one TRUNCATE+rebuild
seed. Lets a teammate without the local Excel folders bootstrap a dev DB
from psql alone.

Decisions are identical to load.py:
- Customers 4001..4018, explicit IDs 1..18
- Q-numbers regenerated via the schema's `fn_next_doc_no` formula computed
  ahead of time (same monotonic per-company-per-year seq behaviour). Each
  file keeps its own historical year token (a 2024 file gets `/.../2024`,
  a 2025 file gets `/.../2025`, etc.)
- Original Q-no recorded in quotations.notes
- Duplicates by original Q-no become a date-ordered version chain
- Status = 'draft' when every line has selling_price <= 0 (Excel pricing
  not yet entered), else 'sent'
"""
from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from unit_map import canonical_unit


HERE = Path(__file__).parent
STAGED_FILE = HERE / "staged.json"
# This script lives at apps/api/db/import/; output goes to sibling seeds/.
OUTPUT_FILE = HERE.parent / "seeds" / "03_historical.sql"

SUPERADMIN_ID = 1

# Mirrors load.py CUSTOMERS — 4001..4010 from 2026, 4011..4015 from 2025,
# 4016..4018 from 2024. parse.py CANONICAL_CUSTOMERS uses the same set.
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

# Static unit code → id mapping that mirrors db/seeds/01_master.sql so we
# don't need a live DB to look this up.
UNIT_CODE_TO_ID: dict[str, int] = {
    "MT": 1, "WT": 2, "KG": 3, "GR": 4, "KRT": 5, "KL": 6, "LTR": 7,
    "BBL": 8, "MMBTU": 9, "AMP": 10, "CM3": 11, "M2": 12, "MTR": 13,
    "IN": 14, "CM": 15, "YD": 16, "DOZ": 17, "UNIT": 18, "SET": 19,
    "LBR": 20, "PCS": 21, "BOX": 22, "YR": 23, "MON": 24, "WK": 25,
    "DAY": 26, "HR": 27, "MIN": 28, "PCT": 29, "KEG": 30, "LAP": 31,
    "BHN": 32, "OTH": 33, "TIN": 34, "TUB": 35, "PKT": 36, "BTL": 37,
    "PRS": 38, "RLS": 39, "SPL": 40,
}

# Roman numerals for fn_month_to_roman compatibility.
ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"]


def normalize_phone(raw: str | None) -> str | None:
    if not raw:
        return None
    digits = re.sub(r"\D", "", str(raw))
    if not digits:
        return None
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
    """Lowercase + collapse whitespace + strip Indonesian honorifics."""
    if not s:
        return ""
    out = re.sub(r"\s+", " ", s.strip().lower())
    # Strip leading honorific (e.g. "Ibu Aisya" → "aisya")
    out = _HONORIFIC_RE.sub("", out)
    return out


def truncate_to(value: str | None, n: int) -> str | None:
    if value is None:
        return None
    return value[:n]


def item_dedup_key(impa: str | None, name: str) -> str:
    impa = (impa or "").strip()
    return f"impa:{impa}" if impa else f"name:{norm_name(name)}"


def sql_str(s: str | None) -> str:
    """SQL literal for TEXT/VARCHAR. Returns NULL or quoted string."""
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"


def sql_num(v) -> str:
    """SQL numeric literal."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    return str(v)


def fn_next_doc_no(prefix: str, company_no: str, seq: int, year: int, month: int) -> str:
    """Match schema's `fn_next_doc_no` output exactly."""
    yy = f"{year % 100:02d}"
    return f"{prefix}-{yy}{company_no}{seq}/GNS/{ROMAN[month-1]}/{year}"


# ---------------------------------------------------------------------------
def main():
    parsed = json.loads(STAGED_FILE.read_text(encoding="utf-8"))["parsed"]
    print(f"Loaded {len(parsed)} files")

    # Sort all by date ASC + qno for stable output
    parsed.sort(key=lambda r: (r["date_iso"] or "9999-99-99",
                                r["raw_qno_norm"] or ""))

    # Group by original qno_norm for revision chains
    groups: dict[str, list[dict]] = defaultdict(list)
    for r in parsed:
        key = r["raw_qno_norm"] or r["file"]
        groups[key].append(r)

    # ----- Build master tables (deduped) -----
    contacts: dict[tuple[int, str], dict] = {}
    contact_id_counter = 0
    contact_id_map: dict[tuple[int, str], int] = {}
    seen_emails: set[str] = set()
    for r in parsed:
        cust_id = CUSTOMER_NAME_TO_ID[r["customer_name"]]
        name = r["contact_name"]
        if not name:
            continue
        key = (cust_id, norm_name(name))
        if key not in contacts:
            email = truncate_to(r.get("contact_email"), 255)
            # idx_company_contacts_email is UNIQUE on lower(email). Drop the
            # email on later contacts that share an address with an earlier
            # one (keep the contact row).
            if email:
                ek = email.lower()
                if ek in seen_emails:
                    email = None
                else:
                    seen_emails.add(ek)
            contact_id_counter += 1
            contacts[key] = {
                "id": contact_id_counter,
                "company_id": cust_id,
                "name": truncate_to(name, 255),
                "email": email,
                "phone": normalize_phone(r.get("contact_phone_raw")),
            }
            contact_id_map[key] = contact_id_counter

    items_master: dict[str, dict] = {}
    items_id_map: dict[str, int] = {}
    item_id_counter = 0
    for r in parsed:
        for it in r["items"]:
            name = it.get("offer_desc") or it.get("nama_asli") or it.get("request_desc")
            if not name:
                continue
            key = item_dedup_key(it.get("impa"), name)
            if key in items_master:
                continue
            item_id_counter += 1
            unit_code = canonical_unit(it.get("unit"))
            items_master[key] = {
                "id": item_id_counter,
                "name": truncate_to(name, 500),
                "impa_code": truncate_to(it.get("impa"), 20),
                "default_unit_id": UNIT_CODE_TO_ID.get(unit_code) if unit_code else None,
            }
            items_id_map[key] = item_id_counter

    vendors_master: dict[str, dict] = {}
    vendors_id_map: dict[str, int] = {}
    vendor_id_counter = 0
    for r in parsed:
        for it in r["items"]:
            v = it.get("vendor_name")
            if not v:
                continue
            v_clean = " / ".join(p.strip() for p in re.split(r"[\n,]", v) if p.strip())
            if not v_clean:
                continue
            key = norm_name(v_clean)
            if key in vendors_master:
                continue
            vendor_id_counter += 1
            vendors_master[key] = {
                "id": vendor_id_counter,
                "name": truncate_to(v_clean, 255),
            }
            vendors_id_map[key] = vendor_id_counter

    # vendor_products: (vendor_id, item_id) → cost_price (last write wins)
    vp_map: dict[tuple[int, int], float] = {}
    for r in parsed:
        for it in r["items"]:
            v_raw = it.get("vendor_name")
            if not v_raw:
                continue
            v_clean = " / ".join(p.strip() for p in re.split(r"[\n,]", v_raw) if p.strip())
            v_id = vendors_id_map.get(norm_name(v_clean))
            if not v_id:
                continue
            name = it.get("offer_desc") or it.get("nama_asli") or it.get("request_desc")
            if not name:
                continue
            i_id = items_id_map.get(item_dedup_key(it.get("impa"), name))
            if not i_id:
                continue
            cost = it.get("cost_price")
            if cost is None or cost < 0:
                cost = 0
            vp_map[(v_id, i_id)] = cost

    # vendor_product_id lookup for quotation_items
    vp_id_lookup: dict[tuple[int, int], int] = {}
    for idx, key in enumerate(vp_map.keys(), start=1):
        vp_id_lookup[key] = idx

    # ----- Quotation generation -----
    # Per (company, year) seq counter, mirrors fn_next_doc_no
    seq_counter: dict[tuple[int, int], int] = defaultdict(int)
    quotations: list[dict] = []
    quotation_items: list[dict] = []
    quotation_id_counter = 0
    quotation_item_id_counter = 0

    for qkey, group in groups.items():
        group.sort(key=lambda r: r["date_iso"] or "9999-99-99")
        prev_id: int | None = None
        for v_idx, file_data in enumerate(group, start=1):
            cust_id = CUSTOMER_NAME_TO_ID[file_data["customer_name"]]
            cust_no = next(c[1] for c in CUSTOMERS if c[0] == cust_id)
            cust_name = next(c[2] for c in CUSTOMERS if c[0] == cust_id)
            contact_id = None
            contact_name = None
            if file_data.get("contact_name"):
                contact_id = contact_id_map.get(
                    (cust_id, norm_name(file_data["contact_name"]))
                )
                if contact_id:
                    contact_name = contacts[(cust_id, norm_name(file_data["contact_name"]))]["name"]

            # Build line items
            lines: list[dict] = []
            for line_no, it in enumerate(file_data["items"], start=1):
                qty = it.get("qty") or 0
                sell = it.get("selling_price")
                if qty <= 0 and (sell is None or sell <= 0):
                    continue
                if sell is None:
                    sell = 0.0
                cost = it.get("cost_price")
                # Profit_pct overflow guard (NUMERIC(7,4), max ~999.99). If
                # sell/cost > 999×, the cost is almost certainly an Excel typo
                # — drop it so profit_pct ends up NULL via NULLIF.
                if cost is not None and cost > 0 and sell > 0 and sell / cost > 999:
                    cost = None
                unit_code = canonical_unit(it.get("unit"))
                unit_id = UNIT_CODE_TO_ID.get(unit_code) if unit_code else None
                name = it.get("offer_desc") or it.get("nama_asli") or it.get("request_desc")
                item_id = items_id_map.get(item_dedup_key(it.get("impa"), name)) if name else None

                vp_id = None
                if it.get("vendor_name"):
                    v_clean = " / ".join(p.strip() for p in re.split(r"[\n,]", it["vendor_name"]) if p.strip())
                    v_id = vendors_id_map.get(norm_name(v_clean))
                    if v_id and item_id:
                        vp_id = vp_id_lookup.get((v_id, item_id))

                lines.append({
                    "line_number": line_no,
                    "requested_item_id": item_id,
                    "requested_impa": truncate_to(it.get("impa"), 20),
                    "requested_name": truncate_to(it.get("request_desc") or name or "", 5000),
                    "offered_item_id": item_id,
                    "vendor_product_id": vp_id,
                    "qty": qty,
                    "unit_id": unit_id,
                    "selling_price": sell,
                    "cost_price": cost,
                })

            if not lines:
                continue

            # Generate Q-number from the file's historical year/month so the
            # token matches the original Excel date (a 2024 file gets `/2024`,
            # a 2025 file gets `/2025`, etc.).
            date_iso = file_data["date_iso"]
            try:
                d = datetime.strptime(date_iso, "%Y-%m-%d")
                year = d.year
                month = d.month
                day = d.day
            except (ValueError, TypeError):
                # Undated file — bucket under 2026 jan 1 as a last resort.
                year, month, day = 2026, 1, 1
                date_iso = "2026-01-01"
            seq_key = (cust_id, year)
            seq_counter[seq_key] += 1
            new_qno = fn_next_doc_no("Q", cust_no, seq_counter[seq_key], year, month)

            # Status: 'draft' if no line has positive selling_price (matches
            # load.py — Excel pricing not yet entered). Else 'sent'.
            is_draft = not any((li["selling_price"] or 0) > 0 for li in lines)
            status = "draft" if is_draft else "sent"

            # Totals
            discount = file_data.get("discount_pct") or 0
            total_produk = sum(li["qty"] * li["selling_price"] for li in lines)
            total = total_produk
            total_discount = total_produk * (discount / 100)

            # client_ref_no: drop placeholders like "By Email"
            ref = file_data.get("your_ref")
            if ref and re.match(r"^by\s+(email|wa|whatsapp|telp|fax)\.?$",
                                 ref.strip(), re.IGNORECASE):
                ref = None

            notes = (
                "Imported from Excel"
                f"\nOriginal Q-no: {file_data.get('raw_qno_norm')}"
                f"\nFile: {file_data.get('file')}"
            )

            quotation_id_counter += 1
            quotations.append({
                "id": quotation_id_counter,
                "quotation_no": new_qno,
                "version": v_idx,
                "parent_id": prev_id,
                "company_client_id": cust_id,
                "company_client_name": cust_name,
                "contact_id": contact_id,
                "contact_name": contact_name,
                "client_ref_no": truncate_to(ref, 100),
                "vessel_name": truncate_to(file_data.get("vessel_name"), 255),
                "status": status,
                "payment_terms": truncate_to(file_data.get("payment_terms"), 100),
                "discount_pct": discount,
                "total_produk": total_produk,
                "total": total,
                "total_discount": total_discount,
                "notes": notes,
                "date_iso": date_iso,
            })
            prev_id = quotation_id_counter

            for li in lines:
                quotation_item_id_counter += 1
                quotation_items.append({
                    "id": quotation_item_id_counter,
                    "quotation_id": quotation_id_counter,
                    **li,
                    "discount_pct": discount,
                })

    print(f"Built: {len(quotations)} quotations, {len(quotation_items)} items, "
          f"{len(items_master)} catalog items, {len(vendors_master)} vendors, "
          f"{len(vp_map)} vendor_products, {len(contacts)} contacts")

    # ----- Render SQL -----
    out: list[str] = []
    out.append("-- HISTORICAL IMPORT (2024 + 2025 + 2026) — auto-generated by apps/api/db/import/generate_seed.py")
    out.append("-- DO NOT EDIT BY HAND. Re-run the generator after parse.py if Excel changes.")
    out.append("-- TRUNCATE-and-rebuild seed: replaces any prior 03_historical_*.sql.\n")
    out.append("BEGIN;\n")

    out.append("-- 0. Reset transactional + master-customer tables; preserve users (superadmin and dev users) and units/countries")
    out.append("""TRUNCATE TABLE
  invoice_items, invoices,
  purchase_order_items, purchase_orders,
  quotation_status_history, quotation_items, quotations,
  item_request_matches,
  vendor_products, items,
  company_contacts, company_client,
  vendors,
  doc_sequences
RESTART IDENTITY CASCADE;
""")

    # -- Customers --
    out.append(f"-- 1. Customers ({len(CUSTOMERS)} entities, IDs 1..{len(CUSTOMERS)})")
    out.append("INSERT INTO company_client (id, number, name, country_code, created_by, updated_by) VALUES")
    rows = []
    for cid, num, name in CUSTOMERS:
        rows.append(f"  ({cid}, {sql_str(num)}, {sql_str(name)}, 'IDN', "
                    f"{SUPERADMIN_ID}, {SUPERADMIN_ID})")
    out.append(",\n".join(rows) + ";")
    out.append(f"SELECT setval('company_client_id_seq', {len(CUSTOMERS)});\n")

    # -- Contacts --
    out.append(f"-- 2. Contacts ({len(contacts)})")
    if contacts:
        out.append("INSERT INTO company_contacts (id, company_id, name, email, phone, country_code, created_by, updated_by) VALUES")
        rows = []
        for c in contacts.values():
            rows.append(
                f"  ({c['id']}, {c['company_id']}, {sql_str(c['name'])}, "
                f"{sql_str(c['email'])}, {sql_str(c['phone'])}, 'IDN', "
                f"{SUPERADMIN_ID}, {SUPERADMIN_ID})"
            )
        out.append(",\n".join(rows) + ";")
        out.append(f"SELECT setval('company_contacts_id_seq', {contact_id_counter});\n")

    # -- Items --
    out.append(f"-- 3. Items master ({len(items_master)})")
    out.append("INSERT INTO items (id, name, impa_code, default_unit_id, created_by, updated_by) VALUES")
    rows = []
    for it in items_master.values():
        rows.append(
            f"  ({it['id']}, {sql_str(it['name'])}, {sql_str(it['impa_code'])}, "
            f"{sql_num(it['default_unit_id'])}, {SUPERADMIN_ID}, {SUPERADMIN_ID})"
        )
    # Chunk to keep individual statements reasonable
    CHUNK = 200
    for i in range(0, len(rows), CHUNK):
        chunk = rows[i:i+CHUNK]
        if i > 0:
            out.append("INSERT INTO items (id, name, impa_code, default_unit_id, created_by, updated_by) VALUES")
        out.append(",\n".join(chunk) + ";")
    out.append(f"SELECT setval('items_id_seq', {item_id_counter});\n")

    # -- Vendors --
    out.append(f"-- 4. Vendors master ({len(vendors_master)})")
    out.append("INSERT INTO vendors (id, name, created_by, updated_by) VALUES")
    rows = []
    for v in vendors_master.values():
        rows.append(f"  ({v['id']}, {sql_str(v['name'])}, {SUPERADMIN_ID}, {SUPERADMIN_ID})")
    for i in range(0, len(rows), CHUNK):
        chunk = rows[i:i+CHUNK]
        if i > 0:
            out.append("INSERT INTO vendors (id, name, created_by, updated_by) VALUES")
        out.append(",\n".join(chunk) + ";")
    out.append(f"SELECT setval('vendors_id_seq', {vendor_id_counter});\n")

    # -- Vendor Products --
    out.append(f"-- 5. Vendor products ({len(vp_map)})")
    out.append("INSERT INTO vendor_products (id, vendor_id, item_id, cost_price, created_by, updated_by) VALUES")
    rows = []
    for (v_id, i_id), cost in vp_map.items():
        vp_id = vp_id_lookup[(v_id, i_id)]
        rows.append(
            f"  ({vp_id}, {v_id}, {i_id}, {cost:.2f}, {SUPERADMIN_ID}, {SUPERADMIN_ID})"
        )
    for i in range(0, len(rows), CHUNK):
        chunk = rows[i:i+CHUNK]
        if i > 0:
            out.append("INSERT INTO vendor_products (id, vendor_id, item_id, cost_price, created_by, updated_by) VALUES")
        out.append(",\n".join(chunk) + ";")
    out.append(f"SELECT setval('vendor_products_id_seq', {len(vp_map)});\n")

    # -- Doc sequences (record last_seq used) --
    out.append("-- 6. doc_sequences — record sequence per (company, year) so future fn_next_doc_no continues correctly")
    if seq_counter:
        out.append("INSERT INTO doc_sequences (doc_type, company_id, year, last_seq) VALUES")
        rows = []
        for (cid, year), seq in sorted(seq_counter.items()):
            rows.append(f"  ('Q', {cid}, {year}, {seq})")
        out.append(",\n".join(rows) + ";\n")

    # -- Quotations --
    out.append(f"-- 7. Quotations ({len(quotations)})")
    out.append("""INSERT INTO quotations (
  id, quotation_no, version, parent_id, company_client_id, company_client_name,
  contact_id, contact_name, client_ref_no, vessel_name, status,
  payment_terms, discount_pct,
  total_produk, total, total_discount,
  notes, created_at, created_by, updated_by
) VALUES""")
    rows = []
    for q in quotations:
        created_at = (
            f"((TIMESTAMP '{q['date_iso']} 09:00:00') AT TIME ZONE 'Asia/Jakarta')"
        )
        rows.append(
            f"  ({q['id']}, {sql_str(q['quotation_no'])}, {q['version']}, "
            f"{sql_num(q['parent_id'])}, {q['company_client_id']}, {sql_str(q['company_client_name'])}, "
            f"{sql_num(q['contact_id'])}, {sql_str(q['contact_name'])}, "
            f"{sql_str(q['client_ref_no'])}, {sql_str(q['vessel_name'])}, {sql_str(q['status'])}, "
            f"{sql_str(q['payment_terms'])}, {q['discount_pct']}, "
            f"{q['total_produk']:.2f}, {q['total']:.2f}, {q['total_discount']:.2f}, "
            f"{sql_str(q['notes'])}, {created_at}, {SUPERADMIN_ID}, {SUPERADMIN_ID})"
        )
    CHUNK_Q = 50
    for i in range(0, len(rows), CHUNK_Q):
        chunk = rows[i:i+CHUNK_Q]
        if i > 0:
            out.append("""INSERT INTO quotations (
  id, quotation_no, version, parent_id, company_client_id, company_client_name,
  contact_id, contact_name, client_ref_no, vessel_name, status,
  payment_terms, discount_pct,
  total_produk, total, total_discount,
  notes, created_at, created_by, updated_by
) VALUES""")
        out.append(",\n".join(chunk) + ";")
    out.append(f"SELECT setval('quotations_id_seq', {quotation_id_counter});\n")

    # -- Quotation items --
    out.append(f"-- 8. Quotation items ({len(quotation_items)})")
    out.append("""INSERT INTO quotation_items (
  id, quotation_id, line_number, item_type,
  requested_item_id, requested_impa, requested_name,
  offered_item_id, vendor_product_id,
  qty, unit_id, selling_price, cost_price, discount_pct,
  update_vendor_price, created_by, updated_by
) VALUES""")
    rows = []
    for li in quotation_items:
        rows.append(
            f"  ({li['id']}, {li['quotation_id']}, {li['line_number']}, 'product', "
            f"{sql_num(li['requested_item_id'])}, {sql_str(li['requested_impa'])}, "
            f"{sql_str(li['requested_name'])}, "
            f"{sql_num(li['offered_item_id'])}, {sql_num(li['vendor_product_id'])}, "
            f"{li['qty']}, {sql_num(li['unit_id'])}, "
            f"{li['selling_price']:.2f}, {sql_num(li['cost_price'])}, "
            f"{li['discount_pct']}, FALSE, {SUPERADMIN_ID}, {SUPERADMIN_ID})"
        )
    CHUNK_I = 100
    for i in range(0, len(rows), CHUNK_I):
        chunk = rows[i:i+CHUNK_I]
        if i > 0:
            out.append("""INSERT INTO quotation_items (
  id, quotation_id, line_number, item_type,
  requested_item_id, requested_impa, requested_name,
  offered_item_id, vendor_product_id,
  qty, unit_id, selling_price, cost_price, discount_pct,
  update_vendor_price, created_by, updated_by
) VALUES""")
        out.append(",\n".join(chunk) + ";")
    out.append(f"SELECT setval('quotation_items_id_seq', {quotation_item_id_counter});\n")

    out.append("COMMIT;\n")
    out.append("-- End of historical import (2024 + 2025 + 2026)")

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text("\n".join(out), encoding="utf-8")

    file_size_kb = OUTPUT_FILE.stat().st_size / 1024
    print(f"\nWrote {OUTPUT_FILE} ({file_size_kb:.1f} KB)")
    print(f"  {len(quotations)} quotations / {len(quotation_items)} items")
    print(f"  {len(items_master)} catalog items, {len(vendors_master)} vendors")
    print(f"  Per-customer counts:")
    by_cust = defaultdict(int)
    for q in quotations:
        by_cust[q["company_client_id"]] += 1
    for cid, num, name in CUSTOMERS:
        print(f"    [{by_cust[cid]:3}] #{num} {name}")


if __name__ == "__main__":
    main()
