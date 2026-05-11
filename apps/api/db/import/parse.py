"""Parse historical Excel quotations into a normalized JSON staging file.

Reads every .xlsx in SOURCE_DIRS (2024/2025/2026), extracts header
(customer, date, contact, etc) and items from the DATA ENTRI sheet, plus
discount info from the PRINT sheet, and writes everything to staged.json
for downstream consumers (load*.py, generate_seed.py).
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
    Path(r"D:\quotation\2025_data"),
    Path(r"D:\quotation\2026_data"),
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


def detect_columns(ws) -> dict[str, int]:
    """Map logical fields → 0-based col idx by scanning row 11 + 12 headers.

    Why: 2024 and 2025+ Excel templates put 'Nama Asli barang', 'Vendor', sell/cost
    sections in different column positions. Hardcoded offsets misread 2024 files
    (e.g. nama_asli at col 13 picks up the cost-price value instead).

    2024 layout (row 11): No Qty Unit DESC . . JUAL . . . . BELI . . . %profit Laba NamaAsli Vendor Telp
    2025 layout (row 11): No Qty Unit DESC . . HargaJual . Modal . %profit Laba NamaAsli Vendor Telp
    """
    cols: dict[str, int] = {}
    SCAN = 25  # columns to inspect (A..Y is enough)
    for c in range(0, SCAN):
        v = cell(ws, 11, c)
        if v is None:
            continue
        s = str(v).strip()
        u = s.upper().replace(" ", "")
        if u in ("NO.", "NO") and "no" not in cols:
            cols["no"] = c
        elif u == "QTY":
            cols["qty"] = c
        elif u == "UNIT" and "unit" not in cols:
            cols["unit"] = c
        elif u.startswith("DESCRIPTION") or "DESCRIPTION" in u or u == "DESC":
            cols["desc"] = c
        elif u == "IMPA":
            cols["impa"] = c
        elif "OFFER" in u and "desc" in cols:
            cols["offer_desc"] = c
        elif u in ("JUAL", "HARGAJUAL"):
            cols["sell_section"] = c
        elif u in ("BELI", "MODAL", "HARGABELI"):
            cols["cost_section"] = c
        elif u == "%PROFIT" or u == "PROFIT":
            cols["profit_pct"] = c
        elif u == "LABA":
            cols["laba"] = c
        elif "NAMAASLI" in u:
            cols["nama_asli"] = c
        elif u == "VENDOR":
            cols["vendor"] = c
        elif u == "TELP":
            cols["vendor_telp"] = c

    # Row 12 sub-headers ('Harga Jual'/'Unit Price'/'Harga Beli'/'Amount').
    # Use them to locate the unit/amount columns within sell/cost sections.
    sell_start = cols.get("sell_section")
    cost_start = cols.get("cost_section")
    profit_start = cols.get("profit_pct", SCAN)

    sell_end = cost_start if cost_start is not None else profit_start
    cost_end = profit_start

    if sell_start is not None:
        for c in range(sell_start, min(sell_end, SCAN)):
            v = cell(ws, 12, c)
            if v is None:
                continue
            u = str(v).upper().replace(" ", "")
            if u in ("UNITPRICE", "HARGAJUAL") and "sell_unit" not in cols:
                cols["sell_unit"] = c
            elif u == "AMOUNT" and "sell_amt" not in cols:
                cols["sell_amt"] = c
        # Fallback when row 12 sub-headers are missing: assume section header
        # itself sits above the unit price column (2025+ layout).
        cols.setdefault("sell_unit", sell_start)

    if cost_start is not None:
        for c in range(cost_start, min(cost_end, SCAN)):
            v = cell(ws, 12, c)
            if v is None:
                continue
            u = str(v).upper().replace(" ", "")
            if u in ("UNITPRICE", "HARGABELI", "MODAL") and "cost_unit" not in cols:
                cols["cost_unit"] = c
            elif u == "AMOUNT" and "cost_amt" not in cols:
                cols["cost_amt"] = c
        cols.setdefault("cost_unit", cost_start)

    return cols


def first_numeric_in_span(ws, row: int, start_col: int, span: int = 2) -> float | None:
    """Read first numeric cell within [start_col, start_col+span-1].

    Why: 2024 template puts a literal 'Rp.' in the cell directly under the section
    header, with the numeric value one column to the right. 2025+ has the number
    directly under the header. Scanning a 2-col window handles both.
    """
    for c in range(start_col, start_col + span):
        n = parse_num(cell(ws, row, c))
        if n is not None:
            return n
    return None


def first_text_in_span(ws, row: int, start_col: int, span: int = 2) -> str | None:
    """Skip cells that are pure 'Rp.' / 'Rp' template residue; return first real text."""
    for c in range(start_col, start_col + span):
        v = cell(ws, row, c)
        if v is None:
            continue
        s = str(v).strip()
        if not s:
            continue
        if re.fullmatch(r"Rp\.?", s, re.IGNORECASE):
            continue
        return s
    return None


def row_has_total(ws, row: int, scan_cols: int = 12) -> bool:
    """True if any cell in row 'row' contains the word TOTAL.

    Why: 2024 puts 'TOTAL' at a different column than 2025+. Scanning a small
    range handles both without hardcoding.
    """
    for c in range(0, scan_cols):
        v = cell(ws, row, c)
        if v and isinstance(v, str) and "TOTAL" in v.upper():
            return True
    return False


_VENDOR_NOISE_RE = re.compile(r"^\s*(?:Rp\.?|[\W_]+)\s*$")


def is_vendor_noise(name) -> bool:
    """True when a vendor cell value is template residue, not a real vendor.

    Filters: blank, currency prefix 'Rp.' / 'Rp', pure punctuation/dashes,
    and tokens shorter than 3 chars (after strip) — these have always been
    Excel template artifacts, never real vendor names in observed data.
    """
    if name is None:
        return True
    s = str(name).strip()
    if len(s) < 3:
        return True
    return bool(_VENDOR_NOISE_RE.match(s))


def parse_items(data_ws, has_impa: bool, cols: dict[str, int] | None = None) -> list[dict]:
    """Read data rows from DATA ENTRI starting after row 12.

    Multi-page DATA ENTRI sheets duplicate the customer/qno/date/PIC header
    every print page (rows like ``no='Customer :', desc='PT. ...'``). The
    item-row gate requires `no` to be an integer (or `qty` to be a positive
    number) so these label rows never reach the items list.
    """
    if cols is None:
        cols = detect_columns(data_ws)

    c_no       = cols.get("no", 0)
    c_qty      = cols.get("qty", 1)
    c_unit     = cols.get("unit", 2)
    c_desc     = cols.get("desc", 3)
    c_impa     = cols.get("impa")
    c_offer    = cols.get("offer_desc")
    c_sellu    = cols.get("sell_unit")
    c_sella    = cols.get("sell_amt")
    c_costu    = cols.get("cost_unit")
    c_costa    = cols.get("cost_amt")
    c_nama     = cols.get("nama_asli")
    c_vendor   = cols.get("vendor")
    c_telp     = cols.get("vendor_telp")

    items: list[dict] = []
    max_row = data_ws.max_row or 200
    for r in range(13, max_row + 1):
        if row_has_total(data_ws, r):
            break
        no = cell(data_ws, r, c_no)
        qty = cell(data_ws, r, c_qty)
        unit = cell(data_ws, r, c_unit)
        desc = cell(data_ws, r, c_desc)
        if not desc:
            continue
        qty_pos = isinstance(qty, (int, float)) and qty > 0
        if not (is_int_str(no) or qty_pos):
            continue

        sell_unit = first_numeric_in_span(data_ws, r, c_sellu) if c_sellu is not None else None
        sell_amt  = first_numeric_in_span(data_ws, r, c_sella) if c_sella is not None else None
        cost_unit = first_numeric_in_span(data_ws, r, c_costu) if c_costu is not None else None
        cost_amt  = first_numeric_in_span(data_ws, r, c_costa) if c_costa is not None else None
        impa = cell(data_ws, r, c_impa) if (has_impa and c_impa is not None) else None
        offer_desc = cell(data_ws, r, c_offer) if c_offer is not None else None
        nama_asli = cell(data_ws, r, c_nama) if c_nama is not None else None
        vendor_raw = cell(data_ws, r, c_vendor) if c_vendor is not None else None
        vendor = None if is_vendor_noise(vendor_raw) else str(vendor_raw)
        vendor_telp = cell(data_ws, r, c_telp) if c_telp is not None else None
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
            "vendor_name": vendor,
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
