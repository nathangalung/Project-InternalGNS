"""Parse all 2026_data Excel files into a normalized JSON staging file.

Reads every .xlsx, extracts header (customer, date, contact, etc) and items
from the DATA ENTRI sheet, plus discount info from the PRINT sheet, and
writes everything to staged.json for the loader to consume.
"""
from __future__ import annotations
import json
import re
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import openpyxl


SOURCE_DIRS = [
    Path(r"D:\quotation\2024_data"),
]
OUTPUT_FILE = Path(__file__).parent / "staged.json"


# ---------------------------------------------------------------------------
# Customer canonicalisation. Maps every observed variant to a canonical name
# plus a 4-digit `number` that becomes company_client.number.
# ---------------------------------------------------------------------------
CANONICAL_CUSTOMERS: list[tuple[str, str, list[str]]] = [
    # (canonical_name, number, list_of_match_substrings_uppercase)
    ("PT. IMC Ship Management",            "4001", ["IMC SHIP", "IMC SHIPPING"]),
    ("PT. Sentra Makmur Lines",            "4002", ["SENTRA MAKMUR"]),
    ("PT. Pelita Global Logistik",         "4003", ["PELITA GLOBAL"]),
    ("PT. Karunia Aman Sentosa",           "4004", ["KARUNIA AMAN SENTOSA"]),
    ("PT. Karunia Aman Selalu",            "4005", ["KARUNIA AMAN SELALU"]),
    ("PT. Niterra Mobility Indonesia",     "4006", ["NITERRA"]),
    ("PT. Mitrabahtera Segara Sejati",     "4007", ["MITRABAHTERA"]),
    ("PT. Aman Maritim Nusantara",         "4008", ["AMAN MARITIM"]),
    ("PT. Kasen Maritim Logistik",         "4009", ["KASEN MARITIM"]),
    ("PT. Adamaris Shipping Indonesia",    "4010", ["ADAMARIS"]),
    # New entries appearing in 2025_data (note: "KARUNIA AMAN SEJAHTERA" must
    # come BEFORE the catch-all "AMAN" entries; we already use full strings
    # above so order within the group doesn't matter, but the more specific
    # SEJAHTERA token avoids any future conflict).
    ("PT. Solusi Pelayaran Nusantara",     "4011", ["SOLUSI PELAYARAN"]),
    ("PT. Transcoal Pasific",              "4012", ["TRANSCOAL"]),
    ("PT. Indobaruna Bulk Transport",      "4013", ["INDOBARUNA"]),
    ("PT. Tara Jaya Cemerlang",            "4014", ["TARA JAYA"]),
    ("PT. Karunia Aman Sejahtera",         "4015", ["KARUNIA AMAN SEJAHTERA"]),
    # 2024 entries. ISNA AGUNG PERMATA covers the PERTAMA misspelling
    # (verified: same PIC + email; user filename is just inconsistent).
    ("PT. Isna Agung Permata",             "4016", ["ISNA AGUNG PERMATA",
                                                     "ISNA AGUNG PERTAMA"]),
    ("PT. Lumoso Pratama Line",            "4017", ["LUMOSO PRATAMA"]),
    ("PT. Indoglas Jaya",                  "4018", ["INDOGLAS"]),
]


def _match_canonical(part: str) -> tuple[str, str] | None:
    """Match a single entity string against CANONICAL_CUSTOMERS."""
    upper = part.upper().replace(".", " ").replace("PT ", "").replace("PT", "").strip()
    for name, num, keys in CANONICAL_CUSTOMERS:
        if any(k in upper for k in keys):
            return (name, num)
    return None


def canonical_customer(raw: str | None) -> tuple[str, str] | None:
    """Return (canonical_name, number) or None.

    Broker pattern: when raw has slash entities AND multiple of them are
    canonical customers (e.g. "PT Mitrabahtera Segara Sejati / PT Aman Maritim
    Nusantara"), the FIRST canonical is the broker and the SECOND canonical is
    the real billing customer. Prefer the second canonical match.

    Otherwise the first match wins.
    """
    if not raw:
        return None
    parts = [p.strip() for p in raw.split("/") if p.strip()]
    if not parts:
        return None
    matches = [_match_canonical(p) for p in parts]
    canonicals = [m for m in matches if m is not None]
    # Two canonicals → broker/customer pattern; prefer the second one.
    if len(canonicals) >= 2:
        return canonicals[1]
    if canonicals:
        return canonicals[0]
    return None


def vessel_from_raw(raw: str | None) -> str | None:
    """Extract second entity from multi-customer slash strings.

    'PT MBSS Tbk/PT Aman Maritim' → 'PT Aman Maritim'.
    Returns None when the second entity itself resolves to a canonical
    customer (broker pattern: customer is in slot 2, no vessel hint here).
    """
    if not raw or "/" not in raw:
        return None
    parts = [p.strip() for p in raw.split("/") if p.strip()]
    if len(parts) < 2:
        return None
    second = parts[1]
    if _match_canonical(second) is not None:
        return None
    return second


# Indonesian + English month names (full and short) → number.
# Lowercase keys; lookup normalises input to lowercase too.
MONTHS_IN: dict[str, int] = {
    "january": 1,  "januari": 1,   "jan": 1,
    "february": 2, "februari": 2,  "feb": 2,
    "march": 3,    "maret": 3,     "mar": 3,
    "april": 4,    "apr": 4,
    "may": 5,      "mei": 5,
    "june": 6,     "juni": 6,      "jun": 6,
    "july": 7,     "juli": 7,      "jul": 7,
    "august": 8,   "agustus": 8,   "aug": 8,  "ags": 8,
    "september": 9,                "sep": 9,  "sept": 9,
    "october": 10, "oktober": 10,  "oct": 10, "okt": 10,
    "november": 11,                "nov": 11,
    "december": 12, "desember": 12, "dec": 12, "des": 12,
}


def parse_indo_date(s: str | None) -> str | None:
    """Parse Indonesian/English date strings to ISO 'YYYY-MM-DD'.

    Handles:
    - 'Jakarta, 06 January 2026' / 'Jakarta, 19 Agustus 2024'
    - Short month names ('Sept', 'Okt', 'Dec', 'Ags', etc.)
    - Missing space between month and year ('February2026')
    - Slash-numeric fallback 'Jakarta, 09/07/2024' → DD/MM/YYYY
    """
    if not s:
        return None
    s = s.strip().replace(",", " ")
    # Try day-month-year with month as a name.
    m = re.search(r"(\d{1,2})\s+([A-Za-z]+)\.?\s*(\d{4})", s)
    if m:
        day = int(m.group(1))
        mon_name = m.group(2).strip(".").lower()
        year = int(m.group(3))
        mon = MONTHS_IN.get(mon_name)
        if mon:
            try:
                return datetime(year, mon, day).date().isoformat()
            except ValueError:
                return None
    # Slash-numeric fallback: DD/MM/YYYY (Indonesian convention).
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if m:
        day, mon, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return datetime(year, mon, day).date().isoformat()
        except ValueError:
            return None
    return None


def parse_num(v) -> float | None:
    """Coerce a cell value to float; return None for non-numeric/blank."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if not s or s.upper() in {"#DIV/0!", "#N/A", "#REF!", "#VALUE!", "0"}:
        return 0.0 if s == "0" else None
    s = s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def is_int_str(v) -> bool:
    """True if v can be parsed as integer (line number)."""
    if v is None:
        return False
    if isinstance(v, int):
        return True
    if isinstance(v, float):
        return v.is_integer()
    s = str(v).strip()
    return s.isdigit()


def cell(ws, row: int, col: int):
    """Return ws cell value or None."""
    if row < 1 or col < 0:
        return None
    try:
        v = ws.cell(row=row, column=col + 1).value
        if v is None:
            return None
        if isinstance(v, str):
            v = v.strip()
            return v if v else None
        return v
    except Exception:
        return None


def find_print_sheet(wb):
    for name in ("PRINT", "PRINT HORIZONTAL", "PRINT VERTIKAL"):
        if name in wb.sheetnames:
            return wb[name]
    return None


def parse_discount(print_ws) -> float:
    """Scan PRINT sheet for 'Diskon X%' label; return X as float (0..100)."""
    if not print_ws:
        return 0.0
    for row in print_ws.iter_rows(min_row=1, max_row=80, values_only=True):
        for v in row:
            if v is None:
                continue
            s = str(v)
            if "diskon" in s.lower() or "discount" in s.lower():
                m = re.search(r"(\d+(?:[.,]\d+)?)\s*%", s)
                if m:
                    return float(m.group(1).replace(",", "."))
    return 0.0


def parse_print_meta(print_ws) -> dict:
    """Best-effort extract delivery place, payment, validity, your-ref, vessel from PRINT."""
    out = {"place_of_delivery": None, "payment": None, "validity": None,
           "your_ref": None, "vessel": None}
    if not print_ws:
        return out
    rows = list(print_ws.iter_rows(min_row=1, max_row=100, values_only=True))
    for r_idx, row in enumerate(rows):
        for c_idx, v in enumerate(row):
            if v is None:
                continue
            s = str(v).strip().upper()
            # Match "DELIVERY TIME", "PLACE OF DELIVERY", etc, then take next non-empty cell.
            if s == "PLACE OF DELIVERY" or s == "DELIVERY PLACE":
                out["place_of_delivery"] = _value_after(rows, r_idx, c_idx)
            elif s == "PAYMENT":
                out["payment"] = _value_after(rows, r_idx, c_idx)
            elif s == "VALIDITY":
                out["validity"] = _value_after(rows, r_idx, c_idx)
            elif s == "YOUR REF NO." or s.startswith("YOUR REF"):
                out["your_ref"] = _value_after(rows, r_idx, c_idx)
        # A vessel name cell often appears on a row by itself between header and items.
        # Heuristic: a single-cell text on rows 13-16 of PRINT that starts with MV/TB/BG/KM.
        if 12 <= r_idx <= 18:
            for v in row:
                if v is None:
                    continue
                s = str(v).strip()
                if re.match(r"^(MV|TB|BG|KM|TUG BOAT|TUG)\b", s, re.IGNORECASE):
                    out["vessel"] = s
                    break
    return out


def _value_after(rows, r_idx, c_idx):
    """Walk right within the same row to find the next non-empty cell."""
    row = rows[r_idx]
    for c in range(c_idx + 1, len(row)):
        v = row[c]
        if v is not None and str(v).strip():
            return str(v).strip()
    return None


def detect_has_impa(data_ws) -> bool:
    """Header row 11: True if column 4 says IMPA or column 5 says OFFER."""
    h4 = cell(data_ws, 11, 4)
    h5 = cell(data_ws, 11, 5)
    return (h4 and "IMPA" in str(h4).upper()) or (h5 and "OFFER" in str(h5).upper())


def parse_items(data_ws, has_impa: bool) -> list[dict]:
    """Read data rows from DATA ENTRI starting after row 12."""
    items: list[dict] = []
    max_row = data_ws.max_row or 200
    for r in range(13, max_row + 1):
        # Stop at TOTAL row in column 6 (Harga Jual section)
        c6 = cell(data_ws, r, 6)
        if c6 and isinstance(c6, str) and "TOTAL" in c6.upper():
            break
        no = cell(data_ws, r, 0)
        qty = cell(data_ws, r, 1)
        unit = cell(data_ws, r, 2)
        desc = cell(data_ws, r, 3)
        # Item row: must have a description AND (No or qty)
        if not desc:
            continue
        if not (no or qty):
            # Possible continuation row of previous item — skip
            continue
        # Parse pieces
        sell_unit = parse_num(cell(data_ws, r, 6))
        sell_amt = parse_num(cell(data_ws, r, 7))
        cost_unit = parse_num(cell(data_ws, r, 8))
        cost_amt = parse_num(cell(data_ws, r, 9))
        impa = cell(data_ws, r, 4) if has_impa else None
        offer_desc = cell(data_ws, r, 5) if has_impa else None
        nama_asli = cell(data_ws, r, 12)
        vendor = cell(data_ws, r, 13)
        vendor_telp = cell(data_ws, r, 14)
        items.append({
            "row": r,
            "no": str(no) if no is not None else None,
            "qty": parse_num(qty) or 0.0,
            "unit": str(unit) if unit else None,
            "request_desc": str(desc) if desc else None,
            "impa": str(impa) if impa else None,
            "offer_desc": str(offer_desc) if offer_desc else None,
            "selling_price": sell_unit,
            "cost_price": cost_unit,
            "vendor_name": str(vendor) if vendor else None,
            "vendor_telp": str(vendor_telp) if vendor_telp else None,
            "nama_asli": str(nama_asli) if nama_asli else None,
        })
    return items


def parse_one(fp: Path) -> dict | None:
    try:
        wb = openpyxl.load_workbook(fp, data_only=True, read_only=False)
    except Exception as e:
        return {"file": fp.name, "error": f"open failed: {e}"}
    try:
        # Tolerate the typo'd "DATA ENTRY" sheet name found in some 2025 files.
        ws = None
        for sheet_name in ("DATA ENTRI", "DATA ENTRY"):
            if sheet_name in wb.sheetnames:
                ws = wb[sheet_name]
                break
        if ws is None:
            return {"file": fp.name, "error": "no DATA ENTRI/DATA ENTRY sheet"}
        print_ws = find_print_sheet(wb)

        # Header layout is identical in 2025 and 2026 templates: customer at
        # openpyxl row 2 col 4, then qno/date/attn/etc on subsequent rows.
        raw_customer = cell(ws, 2, 3)
        raw_qno = cell(ws, 3, 3)
        raw_tgl = cell(ws, 4, 3)
        attn = cell(ws, 5, 3)
        email = cell(ws, 6, 3)
        telp = cell(ws, 7, 3)
        deliv = cell(ws, 8, 3)

        # Normalize qno typo
        qno_norm = (str(raw_qno).replace("/6GNS/", "/GNS/")) if raw_qno else None

        # Resolve customer; for prefix mismatch we trust the customer cell over Q-number
        # (user said: prefix mismatch → fix by using new generated number anyway).
        canon = canonical_customer(raw_customer)
        if canon is None:
            return {"file": fp.name, "error": f"unknown customer: {raw_customer!r}"}
        cust_name, cust_number = canon
        vessel_extra = vessel_from_raw(raw_customer)

        date_iso = parse_indo_date(raw_tgl)
        has_impa = detect_has_impa(ws)
        items = parse_items(ws, has_impa)
        discount_pct = parse_discount(print_ws)
        print_meta = parse_print_meta(print_ws)

        # Vessel: prefer PRINT-detected, else the second slash entity, else None.
        vessel = print_meta.get("vessel") or vessel_extra

        return {
            "file": fp.name,
            "raw_customer": raw_customer,
            "raw_qno": raw_qno,
            "raw_qno_norm": qno_norm,
            "raw_date": raw_tgl,
            "date_iso": date_iso,
            "customer_name": cust_name,
            "customer_number": cust_number,
            "contact_name": attn,
            "contact_email": email,
            "contact_phone_raw": telp,
            "delivery_time": deliv,
            "discount_pct": discount_pct,
            "place_of_delivery": print_meta.get("place_of_delivery"),
            "payment_terms": print_meta.get("payment"),
            "validity": print_meta.get("validity"),
            "your_ref": print_meta.get("your_ref"),
            "vessel_name": vessel,
            "has_impa_column": has_impa,
            "items": items,
        }
    finally:
        wb.close()


def main():
    files: list[Path] = []
    for d in SOURCE_DIRS:
        if not d.exists():
            print(f"[warn] missing source dir: {d}")
            continue
        files.extend(sorted(d.glob("*.xlsx")))
    print(f"Parsing {len(files)} files from {len(SOURCE_DIRS)} dirs...")
    results: list[dict] = []
    errors: list[dict] = []
    for i, fp in enumerate(files, 1):
        out = parse_one(fp)
        if out is None or out.get("error"):
            errors.append(out or {"file": fp.name, "error": "unknown"})
        else:
            results.append(out)
        if i % 25 == 0 or i == len(files):
            print(f"  [{i}/{len(files)}] OK={len(results)} err={len(errors)}")

    # Stats
    print(f"\nParsed: {len(results)}, errors: {len(errors)}")
    if errors:
        print("First 10 errors:")
        for e in errors[:10]:
            print(f"  {e}")

    # Distinct counts
    cust_counts = defaultdict(int)
    contact_counts = defaultdict(set)
    item_total = 0
    discount_dist = defaultdict(int)
    no_date = 0
    for r in results:
        cust_counts[r["customer_name"]] += 1
        if r["contact_name"]:
            contact_counts[r["customer_name"]].add(r["contact_name"])
        item_total += len(r["items"])
        discount_dist[r["discount_pct"]] += 1
        if not r["date_iso"]:
            no_date += 1

    print(f"\n=== By customer ===")
    for k, v in sorted(cust_counts.items(), key=lambda x: -x[1]):
        contacts = len(contact_counts[k])
        print(f"  [{v:3} files, {contacts} contacts] {k}")
    print(f"\nTotal items: {item_total}")
    print(f"Files with no parseable date: {no_date}")
    print(f"\n=== Discount distribution ===")
    for d, n in sorted(discount_dist.items()):
        print(f"  {d:5}% : {n}")

    # Write JSON
    OUTPUT_FILE.write_text(
        json.dumps({"parsed": results, "errors": errors}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\nWrote {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
