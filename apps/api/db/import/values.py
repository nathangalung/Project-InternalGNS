"""Cell value helpers shared by the quotation parser.

Every function takes a raw openpyxl cell value and returns a clean Python
value or None; none of them raise on odd input.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime

# Text cleanup

_EXCEL_ERRORS = {"#REF!", "#NAME?", "#N/A", "#VALUE!", "#DIV/0!", "#NUM!", "#NULL!"}


def clean_text(v: object) -> str | None:
    """Return trimmed text, or None for blank cells.

    Non-breaking spaces become spaces, each line is right-trimmed, and an
    integral float prints without its trailing ".0".
    """
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = str(v).replace("\xa0", " ").replace("\r\n", "\n")
    s = "\n".join(line.rstrip() for line in s.split("\n")).strip()
    return s or None


def norm_label(v: object) -> str:
    """Uppercase a header label and drop every space and colon."""
    s = clean_text(v) or ""
    return re.sub(r"[\s:]+", "", s).upper()


# Numbers

_ID_THOUSANDS = re.compile(r"-?\d{1,3}(\.\d{3})+(,\d+)?")
_EN_THOUSANDS = re.compile(r"-?\d{1,3}(,\d{3})+(\.\d+)?")
_DECIMAL_COMMA = re.compile(r"-?\d+,\d+")


def parse_number(v: object) -> float | None:
    """Coerce a cell to float; None for blanks, text and Excel errors."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, int | float):
        return float(v)
    s = clean_text(v)
    if s is None or s.upper() in _EXCEL_ERRORS:
        return None
    s = re.sub(r"^Rp\.?\s*", "", s, flags=re.IGNORECASE).replace(" ", "")
    if not s:
        return None
    if _ID_THOUSANDS.fullmatch(s):
        s = s.replace(".", "").replace(",", ".")
    elif _EN_THOUSANDS.fullmatch(s):
        s = s.replace(",", "")
    elif _DECIMAL_COMMA.fullmatch(s):
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


# Dates

MONTHS: dict[str, int] = {
    "january": 1, "januari": 1, "jan": 1,
    "february": 2, "februari": 2, "feb": 2, "pebruari": 2,
    "march": 3, "maret": 3, "mar": 3,
    "april": 4, "apr": 4,
    "may": 5, "mei": 5,
    "june": 6, "juni": 6, "jun": 6,
    "july": 7, "juli": 7, "jul": 7,
    "august": 8, "agustus": 8, "aug": 8, "ags": 8, "agu": 8, "agt": 8,
    "agustsus": 8,
    "september": 9, "sep": 9, "sept": 9,
    "october": 10, "oktober": 10, "oct": 10, "okt": 10,
    "november": 11, "nov": 11, "nop": 11, "nopember": 11,
    "december": 12, "desember": 12, "dec": 12, "des": 12,
}  # fmt: skip

_NAMED_DATE = re.compile(r"(\d{1,2})\s*([A-Za-z]+)\.?\s*(\d{4})")
_SLASH_DATE = re.compile(r"(\d{1,2})[/-](\d{1,2})[/-](\d{4})")


def _safe_date(y: int, m: int, d: int) -> date | None:
    try:
        return date(y, m, d)
    except ValueError:
        return None


def parse_date(v: object) -> date | None:
    """Parse a quotation date cell (text in Indonesian or English, or a datetime)."""
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = clean_text(v)
    if s is None:
        return None
    m = _NAMED_DATE.search(s)
    if m:
        mon = MONTHS.get(m.group(2).lower())
        if mon:
            return _safe_date(int(m.group(3)), mon, int(m.group(1)))
    m = _SLASH_DATE.search(s)
    if m:
        return _safe_date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    return None


# IMPA codes

# IMPA Marine Stores Guide section numbers; every code starts with one.
# The corpus has no valid code outside this set.
IMPA_SECTIONS = frozenset({
    "00", "11", "15", "17", "19", "21", "23", "25", "27", "31", "33", "35",
    "37", "39", "45", "47", "49", "51", "53", "55", "57", "59", "61", "63",
    "65", "67", "69", "71", "73", "75", "77", "79", "81", "85", "87",
})  # fmt: skip
_IMPA_IN_TEXT = re.compile(r"\bIMPA\s*[:#.\-]?\s*(\d{6})\b", re.IGNORECASE)


def parse_impa(v: object) -> tuple[str | None, str | None]:
    """Return (code, problem) for an IMPA cell.

    A code is six digits under a known section prefix. Anything else is
    returned as a problem ("invalid" or "unknown_section") and no code.
    """
    s = clean_text(v)
    if s is None:
        return None, None
    if not re.fullmatch(r"\d{6}", s):
        return None, "invalid"
    if s[:2] not in IMPA_SECTIONS:
        return None, "unknown_section"
    return s, None


def impa_codes_in_text(text: str | None) -> list[str]:
    """Return the IMPA codes written as "IMPA nnnnnn" inside free text."""
    if not text:
        return []
    return [c for c in _IMPA_IN_TEXT.findall(text) if c[:2] in IMPA_SECTIONS]


# No Offer lines

_NO_OFFER = re.compile(r"^\s*no\s*(offer|stock)\b", re.IGNORECASE)


def is_no_offer(text: str | None) -> bool:
    """True when an offer text says the item cannot be offered."""
    return bool(text and _NO_OFFER.match(text))


# Clients


@dataclass(frozen=True)
class Client:
    """A canonical client resolved from the customer cell."""

    name: str
    broker_note: str | None = None
    individual: bool = False


# (canonical name, uppercase match keys). The first matching entry wins.
CANONICAL_CLIENTS: list[tuple[str, tuple[str, ...]]] = [
    ("PT. IMC Ship Management", ("IMC SHIP",)),
    ("PT. Sentra Makmur Lines", ("SENTRA MAKMUR",)),
    ("PT. Pelita Global Logistik", ("PELITA GLOBAL",)),
    ("PT. Karunia Aman Sentosa", ("KARUNIA AMAN SENTOSA",)),
    ("PT. Karunia Aman Selalu", ("KARUNIA AMAN SELALU",)),
    ("PT. Karunia Aman Sejahtera", ("KARUNIA AMAN SEJAHTERA",)),
    ("PT. Niterra Mobility Indonesia", ("NITERRA",)),
    ("PT. Mitrabahtera Segara Sejati Tbk", ("MITRABAHTERA", "MBSS")),
    ("PT. Aman Maritim Nusantara", ("AMAN MARITIM",)),
    ("PT. Kasen Maritim Logistik", ("KASEN MARITIM",)),
    ("PT. Adamaris Shipping Indonesia", ("ADAMARIS",)),
    ("PT. Solusi Pelayaran Nusantara", ("SOLUSI PELAYARAN",)),
    ("PT. Transcoal Pacific", ("TRANSCOAL",)),
    ("PT. Indobaruna Bulk Transport", ("INDOBARUNA",)),
    ("PT. Tara Jaya Cemerlang", ("TARA JAYA",)),
    ("PT. Isna Agung Permata", ("ISNA AGUNG",)),
    ("PT. Lumoso Pratama Line", ("LUMOSO PRATAMA",)),
    ("PT. Indoglas Jaya", ("INDOGLAS",)),
    ("PT. Galley Andhika Arnawama", ("GALLEY ANDHIKA", "GALLEY ADHIKA")),
    ("PT. Kemala Shipping", ("KEMALA SHIPPING",)),
    ("PT. Ocean Maritim", ("OCEAN MARITIM",)),
    ("PT. Karya Samudera Insani", ("KARYA SAMUDERA",)),
    ("PT. Amarin Ship Management", ("AMARIN",)),
]

# Individual recipients seen in the customer cell.
INDIVIDUAL_CLIENTS: dict[str, str] = {"PATRICK MANURUNG": "Patrick Manurung"}

_HONORIFIC = re.compile(r"^(BAPAK|BPK|BP|IBU|MR|MRS|MS)\.?\s+", re.IGNORECASE)


def _match_company(part: str) -> str | None:
    upper = re.sub(r"\s+", " ", part.upper().replace(".", " "))
    for name, keys in CANONICAL_CLIENTS:
        if any(k in upper for k in keys):
            return name
    return None


def canonical_client(raw: object) -> Client | None:
    """Resolve the customer cell to a canonical client.

    A brokered cell ("A/B") bills the first company; the second party is
    kept as a note. An individual's honorific is dropped.
    """
    s = clean_text(raw)
    if s is None:
        return None
    parts = [p.strip() for p in s.split("/") if p.strip()]
    name = _match_company(parts[0])
    if name is not None:
        note = " / ".join(parts[1:]) or None
        return Client(name=name, broker_note=note)
    bare = _HONORIFIC.sub("", s).strip().upper()
    if bare in INDIVIDUAL_CLIENTS:
        return Client(name=INDIVIDUAL_CLIENTS[bare], individual=True)
    return None
