"""Read an issued quotation PDF (pdftotext -layout text).

The PDF is what the client received. Its header gives the number, the
client's reference, the date and the contact; its table gives one row
per line (number, quantity, unit, description, unit price, amount) and
its totals block the total, discount and grand total. A table is only
trusted when its amounts add up to the printed total, so a reading that
went wrong is never imported.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

from unit_map import map_unit
from values import parse_date

_HEADER = {
    "number": re.compile(r"\bNo\.?\s*:\s*(Q-?\S+(?:\s\S+)*?)\s*$", re.IGNORECASE),
    "your_ref": re.compile(r"Your\s+Ref\.?\s*no\.?\s*:\s*(.*?)\s*$", re.IGNORECASE),
    "date": re.compile(r"\bDate\s*:\s*(.*?)\s*$", re.IGNORECASE),
    "attn": re.compile(r"^\s*Attn\.?\s*:\s*(.*?)(?:\s{2,}|$)", re.IGNORECASE),
    "email": re.compile(r"^\s*Email\s*:\s*(\S+@\S+)", re.IGNORECASE),
}
# The row number can be lost in the text layer; such a row still has a
# quantity, a known unit and a price.
_ROW = re.compile(r"^\s{0,8}(?:(\d{1,3})\s+)?(\d+(?:[.,]\d+)?)\s+(\S+)\s+(.*\S)\s*$")
_MONEY = re.compile(r"(-?)Rp\.?\s*(\d[\d.]*|-)")
_NO_QUOTE = re.compile(r"\bno\s*(quote|offer)\b", re.IGNORECASE)
_TOTALS = re.compile(r"^\s{20,}([A-Za-z][A-Za-z ()%\d.]*?)\s+(-?)Rp\.?\s*(\d[\d.]*|-)\s*$")


@dataclass
class PdfLine:
    """One printed row of the item table."""

    no: int
    qty: float
    unit: str | None
    request: str
    offer: str | None
    price: float
    amount: float
    available: bool


@dataclass
class PdfQuote:
    """What one issued quotation PDF prints."""

    number: str | None = None
    your_ref: str | None = None
    date: date | None = None
    attn: str | None = None
    email: str | None = None
    lines: list[PdfLine] = field(default_factory=list)
    totals: list[tuple[str, float]] = field(default_factory=list)

    @property
    def items_total(self) -> float | None:
        return self.totals[0][1] if self.totals else None

    @property
    def discount(self) -> float:
        return sum(abs(v) for label, v in self.totals if re.match(r"(?i)dis[ck]", label))

    @property
    def grand(self) -> float | None:
        for label, v in reversed(self.totals):
            if re.match(r"(?i)(grand\s*)?total$", label.strip()):
                return v
        return None


def _money(s: str) -> float:
    return 0.0 if s == "-" else float(s.replace(".", ""))


def _columns(text: str) -> tuple[str, str | None]:
    """Request and offer from a row's description columns."""
    cols = [c.strip() for c in re.split(r"\s{2,}", text) if c.strip()]
    cols = [c for c in cols if not re.fullmatch(r"\d{6}", c)]  # the IMPA column
    if not cols:
        return text.strip(), None
    return cols[0], (cols[-1] if len(cols) > 1 else None)


def _row(m: re.Match[str]) -> PdfLine | None:
    no, qty, unit, rest = m.groups()
    code, mapped = map_unit(unit)
    if not mapped:
        if no is None:
            return None
        rest, code = f"{unit} {rest}", None
    cut = min((x.start() for x in (_MONEY.search(rest), _NO_QUOTE.search(rest)) if x), default=None)
    if cut is None:
        return None
    request, offer = _columns(rest[:cut])
    money = [_money(v) * (-1 if sign else 1) for sign, v in _MONEY.findall(rest[cut:])]
    available = not _NO_QUOTE.search(rest)
    price = money[0] if money and available else 0.0
    amount = money[-1] if money else 0.0
    number = int(no) if no is not None else 0
    return PdfLine(
        number, float(qty.replace(",", ".")), code, request, offer, price, amount, available
    )


def parse_pdf_quote(text: str) -> PdfQuote:
    """Header, rows and totals of one quotation PDF's text."""
    q = PdfQuote()
    in_table = False
    for raw in text.splitlines():
        for key, pattern in _HEADER.items():
            if getattr(q, key) is None:
                m = pattern.search(raw)
                if m and m.group(1).strip():
                    value = m.group(1).strip()
                    setattr(q, key, parse_date(value) if key == "date" else value)
        if re.search(r"(?i)\bunit\s+price\b", raw):
            in_table = True
            continue
        if not in_table:
            continue
        m = _ROW.match(raw)
        if m and not q.totals:
            ln = _row(m)
            if ln is not None and ln.no in (0, len(q.lines) + 1):
                ln.no = len(q.lines) + 1
                q.lines.append(ln)
            continue
        t = _TOTALS.match(raw)
        if t and q.lines:
            label, sign, value = t.groups()
            q.totals.append((label.strip(), _money(value) * (-1 if sign else 1)))
    return q


def trusted(q: PdfQuote, grand: float | None) -> bool:
    """The table adds up to the printed total, and the grand total is the indexed one."""
    total = q.items_total
    if not q.lines or total is None or q.grand is None:
        return False
    if abs(sum(ln.amount for ln in q.lines) - total) > 1:
        return False
    return grand is None or abs(q.grand - grand) <= 1
