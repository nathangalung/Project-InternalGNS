"""Structural reading of quotation sheets.

A workbook holds a DATA ENTRI sheet (header block, item table with sell
and cost) and a PRINT sheet (what the client received: reference,
vessel line, totals block, terms). Both are read by their labels, never
by fixed positions, since the templates moved columns over the years.
Sheets are loaded once into 0-based grids of cached cell values.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from openpyxl.worksheet.worksheet import Worksheet

from values import clean_text, norm_label, parse_number

Grid = list[list[object]]

MAX_COLS = 30


def load_grid(ws: Worksheet, max_cols: int = MAX_COLS) -> Grid:
    """Read a sheet's cached values into a grid, without trailing blank rows."""
    g: Grid = []
    for row in ws.iter_rows(max_col=max_cols, values_only=True):
        cells = list(row) + [None] * (max_cols - len(row))
        g.append(cells)
    while g and all(_is_residue(v) for v in g[-1]):
        g.pop()
    return g


def _at(g: Grid, r: int, c: int | None) -> object:
    if c is None or r < 0 or r >= len(g) or c < 0 or c >= len(g[r]):
        return None
    return g[r][c]


_RESIDUE_TEXT = {"RP", "RP.", "-", ":", "#DIV/0!", "#REF!", "#VALUE!", "#N/A", "#NAME?"}


def _is_residue(v: object) -> bool:
    """True for template filler: blanks, 'Rp.', zeros and formula errors."""
    if v is None:
        return True
    if isinstance(v, int | float) and not isinstance(v, bool):
        return v == 0
    s = clean_text(v)
    return s is None or s.upper() in _RESIDUE_TEXT or bool(re.fullmatch(r"(?i)rp\.?\s*-", s))


def _text(v: object) -> str | None:
    """Cell text, with template filler (0, "-", "Rp.", errors) read as blank."""
    return None if _is_residue(v) else clean_text(v)


def _is_table_header(row: list[object]) -> bool:
    return norm_label(row[0]) in ("NO.", "NO") and "QTY" in norm_label(row[1])


def find_table_header(g: Grid, start: int = 0, stop: int | None = None) -> int | None:
    """Return the index of the first `No. | Qty` row in [start, stop)."""
    for r in range(start, min(stop if stop is not None else len(g), len(g))):
        if _is_table_header(g[r]):
            return r
    return None


# DATA ENTRI header block


@dataclass
class Header:
    """The DATA ENTRI header block (labels in column A, values in D)."""

    customer: str | None = None
    number: str | None = None
    date_raw: object = None
    contact: str | None = None
    email: str | None = None
    phone: str | None = None
    delivery_time: str | None = None
    delivery_place: str | None = None


_HEADER_LABELS: dict[str, str] = {
    "CUSTOMER": "customer",
    "NO": "number",
    "NO.": "number",
    "TGL": "date_raw",
    "DATE": "date_raw",
    "ATTN": "contact",
    "EMAIL": "email",
    "TELP": "phone",
    "CONTACTNO.": "phone",
    "DELIV.TIME": "delivery_time",
    "DELIVERYTIME": "delivery_time",
    "DELIVERYPLACE": "delivery_place",
}
_FIXED_HEADER_ROWS = ("customer", "number", "date_raw", "contact", "email", "phone")


def read_header(g: Grid) -> Header:
    """Read the header block by its labels; only column D is trusted."""
    h = Header()
    hdr = find_table_header(g, 0, 20)
    seen: set[str] = set()
    for r in range(min(hdr if hdr is not None else 12, len(g))):
        key = _HEADER_LABELS.get(norm_label(_at(g, r, 0)))
        if key is None or key in seen:
            continue
        seen.add(key)
        v = _at(g, r, 3)
        setattr(h, key, v if key == "date_raw" else clean_text(v))
    if not seen:
        for i, key in enumerate(_FIXED_HEADER_ROWS, start=1):
            v = _at(g, i, 3)
            setattr(h, key, v if key == "date_raw" else clean_text(v))
    return h


# Item table columns


@dataclass
class Columns:
    """Column indexes of an item table, found from its labels."""

    header_row: int
    no: int = 0
    qty: int | None = None
    unit: int | None = None
    request: int | None = None
    offer: int | None = None
    impa: int | None = None
    sell: int | None = None
    sell_amount: int | None = None
    sell_end: int | None = None
    cost: int | None = None
    cost_amount: int | None = None
    cost_end: int | None = None
    nama_asli: int | None = None
    vendor: int | None = None
    channel: int | None = None
    flags: list[str] = field(default_factory=list)


_SELL = {"JUAL", "HARGAJUAL", "PENJUALAN", "UNITPRICE"}
_COST = {"MODAL", "BELI", "HARGABELI"}
_UNIT_PRICE = {"UNITPRICE", "HARGAJUAL", "HARGABELI", "MODAL", "JUAL"}
_AMOUNT = {"AMOUNT", "TOTALAMOUNT"}


def _section(g: Grid, sub: int, start: int, end: int) -> tuple[int, int | None]:
    unit, amount = None, None
    for c in range(start, end):
        lab = norm_label(_at(g, sub, c))
        if lab in _UNIT_PRICE and unit is None:
            unit = c
        elif lab in _AMOUNT and amount is None:
            amount = c
    if unit is None:
        unit = start
    if amount is None and end - start >= 2:
        amount = unit + 1
    return unit, amount


def _priced_count(g: Grid, header: int, start: int, end: int) -> int:
    n = 0
    for r in range(header + 1, min(header + 80, len(g))):
        for c in range(start, end):
            v = parse_number(_at(g, r, c))
            if v:
                n += 1
                break
    return n


def map_columns(g: Grid) -> Columns | None:
    """Locate the item table header and map its columns by label."""
    hdr = find_table_header(g, 0, 20)
    if hdr is None:
        return None
    cols = Columns(header_row=hdr)
    labelled: list[int] = []
    sells: list[int] = []
    costs: list[int] = []
    amount_hdr: int | None = None
    for c, v in enumerate(g[hdr]):
        lab = norm_label(v)
        if not lab:
            continue
        labelled.append(c)
        if c == 0:
            continue
        if lab == "QTY":
            cols.qty = c
        elif lab == "UNIT" and cols.unit is None:
            cols.unit = c
        elif lab in ("REQUEST", "REQUESTDESCRIPTION", "DESCRIPTION", "DESC"):
            cols.request = c
        elif lab in ("OFFER", "OFFERDESCRIPTION"):
            cols.offer = c
        elif lab.startswith("IMPA"):
            cols.impa = c
        elif lab in _SELL:
            sells.append(c)
        elif lab in _COST:
            costs.append(c)
        elif "NAMAASLI" in lab:
            cols.nama_asli = c
        elif lab == "VENDOR":
            cols.vendor = c
        elif lab in ("TELP", "NOTE"):
            cols.channel = c
        elif lab in _AMOUNT and amount_hdr is None:
            amount_hdr = c
    if cols.request is None and cols.offer is None:
        return None

    sub = hdr + 1

    def end_of(start: int) -> int:
        later = [c for c in labelled if c > start]
        return later[0] if later else start + 2

    if not sells and not costs:
        units = [c for c, v in enumerate(g[sub] if sub < len(g) else []) if norm_label(v) in _SELL]
        if units:
            sells = units[:1]
            costs = units[1:2]
            labelled = sorted(set(labelled) | set(units))
            cols.flags.append("price_sections_from_subheader")
    if len(sells) > 1:
        cols.flags.append("duplicate_sell_column")
        best = max(sells, key=lambda s: (_priced_count(g, hdr, s, end_of(s)), s))
        sells = [best]
    if sells:
        s = sells[0]
        cols.sell_end = end_of(s)
        cols.sell, cols.sell_amount = _section(g, sub, s, cols.sell_end)
        if amount_hdr is not None and amount_hdr > s:
            # PRINT layout: the Amount column has its own header label.
            cols.sell_amount = amount_hdr
            cols.sell_end = min(end_of(amount_hdr), amount_hdr + 3)
    if costs:
        s = costs[0]
        cols.cost_end = end_of(s)
        cols.cost, cols.cost_amount = _section(g, sub, s, cols.cost_end)
    return cols


# Item rows


@dataclass
class Line:
    """One item row as it stands in the sheet, before normalisation."""

    row: int
    no: str | None
    qty: float | None
    unit: str | None
    request: str | None
    offer: str | None
    impa: object = None
    sell: float | None = None
    sell_amount: float | None = None
    cost: float | None = None
    cost_amount: float | None = None
    nama_asli: str | None = None
    vendor: str | None = None
    channel: str | None = None


@dataclass
class Skipped:
    """A non-empty row that did not become a line, and why."""

    row: int
    reason: str
    text: str


_TOTAL_ROW = re.compile(r"^(SUB|GRAND)?TOTAL(\(\d+\))?$")
_PAGE_HEADER = {
    "CUSTOMER", "NO", "TGL", "DATE", "ATTN", "EMAIL", "TELP", "TELP.", "DELIV.TIME",
    "HALAMAN", "PAGE", "PAGES", "CONTACTNO.", "TO", "TO.", "CC", "DELIVERYPLACE",
}  # fmt: skip
_LETTERHEAD = ("GEDUNGWIRAUSAHA", "PT.GLOBALNIAGASAKTI", "WEAREPLEASED", "CONTINUEPAGE")


def _first_number(g: Grid, r: int, start: int | None, end: int | None) -> float | None:
    if start is None:
        return None
    stop = end if end is not None else start + 1
    for c in range(start, max(stop, start + 1)):
        v = parse_number(_at(g, r, c))
        if v is not None:
            return v
    return None


def _row_text(row: list[object]) -> str:
    parts = [clean_text(v) for v in row if not _is_residue(v)]
    return " | ".join(p for p in parts if p)[:200]


def _is_numbered(v: object) -> bool:
    if isinstance(v, bool):
        return False
    if isinstance(v, int | float):
        return True
    s = clean_text(v)
    return bool(s and (re.fullmatch(r"\d+\.?", s) or s.startswith("#")))


def _append(base: str | None, extra: str | None) -> str | None:
    if not extra:
        return base
    return f"{base}\n{extra}" if base else extra


def _amount_bounds(start: int | None, amount: int | None, end: int | None) -> int | None:
    if start is None:
        return None
    return amount if amount is not None else end


def read_lines(
    g: Grid,
    cols: Columns,
    stop_row: int | None = None,
    stop_at_total: bool = True,
) -> tuple[list[Line], list[Skipped]]:
    """Read item rows below the header.

    A row with text and a number, quantity or price is a line; a row with
    only text continues the previous line. Repeated page headers are
    skipped. With stop_at_total, the TOTAL row that no later table header
    follows ends the table (earlier ones are page totals), and non-empty
    rows after it are reported as skipped.
    """
    lines: list[Line] = []
    skipped: list[Skipped] = []
    in_page_header = False
    ended = False
    text_cols = {cols.request, cols.offer} - {None}
    last = len(g) if stop_row is None else min(stop_row, len(g))
    sell_unit_end = _amount_bounds(cols.sell, cols.sell_amount, cols.sell_end)
    cost_unit_end = _amount_bounds(cols.cost, cols.cost_amount, cols.cost_end)
    last_header = max(
        (r for r in range(cols.header_row, last) if _is_table_header(g[r])), default=0
    )
    for r in range(cols.header_row + 1, last):
        row = g[r]
        if all(_is_residue(v) for v in row):
            continue
        if ended:
            skipped.append(Skipped(r + 1, "after total", _row_text(row)))
            continue
        if _is_table_header(row):
            in_page_header = False
            continue
        a = norm_label(row[0])
        if a in _PAGE_HEADER or any(norm_label(v).startswith(_LETTERHEAD) for v in row if v):
            in_page_header = True
            continue
        if in_page_header:
            continue
        labels = [norm_label(v) for v in row]
        if all(lab in _UNIT_PRICE | _AMOUNT | {""} for lab in labels):
            continue

        no_raw = _at(g, r, cols.no)
        qty = parse_number(_at(g, r, cols.qty))
        is_total = any(_TOTAL_ROW.match(lab) for lab in labels)
        if is_total and not qty and not _is_numbered(no_raw):
            if stop_at_total and r > last_header:
                ended = True
            continue

        request = _text(_at(g, r, cols.request))
        offer = _text(_at(g, r, cols.offer))
        sell = _first_number(g, r, cols.sell, sell_unit_end)
        cost = _first_number(g, r, cols.cost, cost_unit_end)
        sell_amount = _first_number(g, r, cols.sell_amount, cols.sell_end)
        has_text = bool(request or offer)
        numbered = _is_numbered(no_raw)
        # An unnumbered row needs a quantity or an amount to be a line: a cost
        # alone is a supplier breakdown, a price alone a note (minimum order).
        priced = bool(qty) or bool(sell_amount) or (numbered and bool(sell))
        if not has_text:
            if (
                numbered
                or priced
                or any(not _is_residue(v) for c, v in enumerate(row) if c not in text_cols)
            ):
                skipped.append(Skipped(r + 1, "no description", _row_text(row)))
            continue
        if not numbered and not priced:
            if lines:
                prev = lines[-1]
                prev.request = _append(prev.request, request)
                prev.offer = _append(prev.offer, offer)
            else:
                skipped.append(Skipped(r + 1, "text before first line", _row_text(row)))
            continue
        lines.append(
            Line(
                row=r + 1,
                no=clean_text(no_raw),
                qty=qty,
                unit=_text(_at(g, r, cols.unit)),
                request=request,
                offer=offer,
                impa=_at(g, r, cols.impa),
                sell=sell,
                sell_amount=sell_amount,
                cost=cost,
                cost_amount=_first_number(g, r, cols.cost_amount, cols.cost_end),
                nama_asli=_text(_at(g, r, cols.nama_asli)),
                vendor=_text(_at(g, r, cols.vendor)),
                channel=_text(_at(g, r, cols.channel)),
            )
        )
    return lines, skipped


# PRINT sheet


@dataclass
class PrintTotals:
    """The totals block printed under the item table."""

    gross: float | None = None
    discount: float | None = None
    discount_label: str | None = None
    discount_pct_label: float | None = None
    net: float | None = None
    dpp: float | None = None
    ppn: float | None = None
    ppn_label: str | None = None
    ppn_rate: float | None = None
    grand: float | None = None
    # (label, amount, before_ppn) for charges such as a delivery line.
    extras: list[tuple[str, float, bool]] = field(default_factory=list)
    rows: list[tuple[str, float | None]] = field(default_factory=list)


@dataclass
class PrintInfo:
    """What a PRINT-layout sheet says."""

    to: str | None = None
    attn: str | None = None
    email: str | None = None
    phone: str | None = None
    number: str | None = None
    your_ref: str | None = None
    date_raw: object = None
    page: str | None = None
    delivery_time: str | None = None
    delivery_place: str | None = None
    payment: str | None = None
    validity: str | None = None
    pre_rows: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    totals: PrintTotals | None = None
    columns: Columns | None = None
    lines: list[Line] = field(default_factory=list)
    skipped: list[Skipped] = field(default_factory=list)


_META = {
    "TO": "to", "TO.": "to", "ATTN": "attn", "EMAIL": "email", "TELP": "phone",
    "TELP.": "phone", "CONTACTNO.": "phone", "NO.": "number", "NO": "number",
    "YOURREFNO.": "your_ref", "YOURREFNO": "your_ref", "YOURREF": "your_ref",
    "DATE": "date_raw", "PAGE": "page", "PAGES": "page",
}  # fmt: skip
_FOOTER = {
    "DELIVERYTIME": "delivery_time",
    "PLACEOFDELIVERY": "delivery_place",
    "DELIVERYPLACE": "delivery_place",
    "PAYMENT": "payment",
    "VALIDITY": "validity",
}
_INLINE = re.compile(r"^\s*([A-Za-z][A-Za-z .]*?)\s*:\s*(.*?)\s*$")
_JUNK_VALUES = {"QUOTATION", "0"}


def _value_right(row: list[object], c: int, labels: dict[str, str], raw: bool) -> object:
    """Return the first value right of a label, stopping at the next label."""
    for v in row[c + 1 : c + 8]:
        if _is_residue(v):
            continue
        if raw and not isinstance(v, str):
            return v
        if norm_label(v) in labels or norm_label(v) in _META or norm_label(v) in _FOOTER:
            return None
        s = clean_text(v)
        if s and s not in _JUNK_VALUES:
            return s
    return None


def _scan_labels(g: Grid, rows: range, labels: dict[str, str], info: PrintInfo) -> None:
    for r in rows:
        row = g[r]
        for c, v in enumerate(row):
            if not isinstance(v, str) or "globalsakti" in v.lower():
                continue  # GNS's own letterhead
            key = labels.get(norm_label(v))
            if key is not None:
                if getattr(info, key) is None:
                    setattr(info, key, _value_right(row, c, labels, raw=key == "date_raw"))
                continue
            for line in v.split("\n"):
                m = _INLINE.match(line)
                if not m:
                    continue
                key = labels.get(norm_label(m.group(1)))
                value = clean_text(m.group(2))
                if key and value and value not in _JUNK_VALUES and getattr(info, key) is None:
                    setattr(info, key, value)


_TOTALS_LABEL = re.compile(r"^(GRANDTOTAL|SUBTOTAL|TOTAL|AFTERDIS|DIS[CK]|DPP|PPN|PPH|VAT)")
_PAGE_SUBTOTAL = re.compile(r"\(\d+\)")
_PCT = re.compile(r"(\d+(?:[.,]\d+)?)\s*%")


def _totals_label(v: object) -> str | None:
    s = clean_text(v)
    if s is None or len(s) > 30:
        return None
    lab = norm_label(s)
    if _TOTALS_LABEL.match(lab) and not _PAGE_SUBTOTAL.search(lab):
        return s
    return None


def _label_in_row(row: list[object]) -> tuple[int, str] | None:
    for c, v in enumerate(row):
        s = _totals_label(v)
        if s is not None:
            return c, s
    return None


def _pct(label: str) -> float | None:
    m = _PCT.search(label)
    return float(m.group(1).replace(",", ".")) if m else None


def _number_col(g: Grid, r: int, start: int) -> int | None:
    for c in range(start, min(start + 4, len(g[r]))):
        if parse_number(g[r][c]) is not None or (
            isinstance(g[r][c], str) and g[r][c].strip().startswith("#")
        ):
            return c
    return None


def _extra_charge(g: Grid, r: int, value_col: int | None) -> tuple[str, float] | None:
    """A labelled amount inside the block, such as a delivery charge."""
    row = g[r]
    if value_col is None or _is_numbered(row[0]):
        return None
    value = parse_number(_at(g, r, value_col))
    texts = [clean_text(v) for c, v in enumerate(row) if c < value_col and isinstance(v, str)]
    label = re.sub(r"\s+", " ", " ".join(t for t in texts if t and not _is_residue(t)))
    if value is None or not label or _TOTALS_LABEL.match(norm_label(label)):
        return None  # page subtotals ("Sub Total (4)") are not charges
    return label, value


def _stacked_totals(g: Grid) -> tuple[PrintTotals | None, int | None]:
    """A totals block a PDF-to-Excel export stacked into single cells.

    One cell lists the labels line by line ("Total\\nDiskon 5%\\n...") and
    the next rows hold the amounts, also stacked, in the same order.
    """
    for r, row in enumerate(g):
        for v in row:
            labels = [s.strip() for s in str(v).split("\n")] if isinstance(v, str) else []
            if len(labels) < 3 or not all(_totals_label(s) for s in labels):
                continue
            values: list[float] = []
            for below in g[r : r + 3]:
                for cell in below:
                    for part in str(cell).split("\n") if isinstance(cell, str) else [cell]:
                        n = parse_number(part)
                        if n is not None and not isinstance(part, int | float):
                            values.append(n)
            if len(values) != len(labels):
                continue
            stacked = [[None] * 3 for _ in labels]
            for i, (label, value) in enumerate(zip(labels, values, strict=True)):
                stacked[i][0], stacked[i][1] = label, value
            t, _ = read_totals(stacked)
            return t, r
    return None, None


def read_totals(g: Grid) -> tuple[PrintTotals | None, int | None]:
    """Find the last totals block; return it and its first row index.

    The block runs upward from the last totals label through contiguous
    totals rows and labelled charges (a delivery line) whose amount sits in
    the block's value column. One gap row (blank, or an unpriced note such
    as "Shipping to Weda") is allowed between them.
    """
    last = None
    for r in range(len(g) - 1, -1, -1):
        if _label_in_row(g[r]) is not None:
            last = r
            break
    if last is None:
        return None, None
    found = _label_in_row(g[last])
    assert found is not None
    value_col = _number_col(g, last, found[0] + 1)
    first = last
    r = last - 1
    gap = False
    while r >= 0 and last - r < 12:
        row = g[r]
        if _label_in_row(row) is not None or _extra_charge(g, r, value_col) is not None:
            first, gap = r, False
        elif not gap and not _is_numbered(row[0]) and _is_residue(_at(g, r, value_col)):
            gap = True
        else:
            break
        r -= 1
    t = PrintTotals()
    for r in range(first, last + 1):
        found = _label_in_row(g[r])
        if found is None:
            extra = _extra_charge(g, r, value_col)
            if extra is not None:
                t.rows.append(extra)
                t.extras.append((extra[0], extra[1], t.ppn_label is None))
            continue
        c, label = found
        value = _first_number(g, r, c + 1, c + 5)
        t.rows.append((label, value))
        lab = norm_label(label)
        if lab.startswith("GRANDTOTAL"):
            t.grand = value
        elif lab.startswith(("PPN", "VAT")):
            t.ppn, t.ppn_label, t.ppn_rate = value, label, _pct(label)
        elif lab.startswith("DPP"):
            t.dpp = value
        elif lab.startswith("AFTERDIS"):
            t.net = value
        elif lab.startswith(("DISC", "DISK")):
            t.discount = abs(value) if value is not None else None
            t.discount_label, t.discount_pct_label = label, _pct(label)
        elif lab.startswith("PPH"):
            # Income tax withheld (PPh 23 on services), deducted after PPN.
            if value is not None:
                t.extras.append((label, -abs(value), False))
        elif t.ppn_label is not None:
            t.grand = value
        elif t.discount_label is not None or t.gross is not None:
            t.net = value
        else:
            t.gross = value
    if t.grand is None and t.ppn_label is None:
        # No PPN row: the last total is what the client pays.
        t.grand = t.net if t.net is not None else t.gross
    return t, first


def _first_item_row(g: Grid, start: int) -> int | None:
    for r in range(start, len(g)):
        if _is_numbered(g[r][0]) and parse_number(g[r][1]) is not None:
            return r
    return None


def read_print(g: Grid) -> PrintInfo:
    """Read a PRINT-layout sheet: meta, vessel rows, lines, totals, terms."""
    info = PrintInfo()
    hdr = find_table_header(g, 0, 40)
    top = hdr if hdr is not None else min(len(g), 12)
    _scan_labels(g, range(top), _META, info)
    info.totals, totals_row = read_totals(g)
    if info.totals is None or info.totals.grand is None:
        stacked, stacked_row = _stacked_totals(g)
        if stacked is not None:
            info.totals, totals_row = stacked, stacked_row
    _scan_labels(g, range(top, len(g)), _FOOTER, info)
    for r in range(top, len(g)):
        for v in g[r]:
            s = clean_text(v) if isinstance(v, str) else None
            if s and re.match(r"^note\s*:", s, re.IGNORECASE):
                info.notes.append(s)
    if hdr is None:
        return info
    first = _first_item_row(g, hdr + 1)
    stop = first if first is not None else totals_row
    for r in range(hdr + 1, stop if stop is not None else len(g)):
        text = _row_text(g[r])
        if text and not all(
            norm_label(v) in _UNIT_PRICE | _AMOUNT for v in g[r] if not _is_residue(v)
        ):
            info.pre_rows.append(text)
    info.columns = map_columns(g)
    if info.columns is not None:
        info.lines, info.skipped = read_lines(
            g, info.columns, stop_row=totals_row, stop_at_total=False
        )
        if first is not None:
            info.skipped = [s for s in info.skipped if s.row > first]
    return info
