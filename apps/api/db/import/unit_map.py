"""Map raw Excel unit strings to canonical unit codes in `units` master."""

from __future__ import annotations

import re

# Maps lowercased raw → canonical CODE in DB units.code.
# Codes match seed file 01_master.sql. An explicit "OTH" means the unit
# was reviewed and has no closer master code.
UNIT_MAP: dict[str, str] = {
    # PCS family
    "pcs": "PCS",
    "pc": "PCS",
    "buah": "PCS",
    "batang": "PCS",
    # SET family
    "set": "SET",
    # BOX family
    "box": "BOX",
    "dus": "BOX",
    "duz": "BOX",
    "ctn": "BOX",
    "case": "BOX",
    # BTL
    "btl": "BTL",
    "botol": "BTL",
    # KG family
    "kg": "KG",
    "kgs": "KG",
    # Meter family
    "m": "MTR",
    "mtr": "MTR",
    "mtrs": "MTR",
    "meter": "MTR",
    "meters": "MTR",
    # Roll family
    "roll": "RLS",
    "rls": "RLS",
    "rol": "RLS",
    "coil": "RLS",
    "coils": "RLS",
    # Spool
    "spl": "SPL",
    "spool": "SPL",
    # Unit / Each
    "unit": "UNIT",
    "ea": "UNIT",
    "each": "UNIT",
    # Packet
    "pkt": "PKT",
    "pck": "PKT",
    "pack": "PKT",
    "pac": "PKT",
    "bungkus": "PKT",
    # TIN / Can
    "tin": "TIN",
    "can": "TIN",
    "kaleng": "TIN",
    # Tube
    "tub": "TUB",
    # Pair
    "prs": "PRS",
    "pair": "PRS",
    "pairs": "PRS",
    "pr": "PRS",
    "pasang": "PRS",
    # Dozen
    "doz": "DOZ",
    "dozen": "DOZ",
    "dzn": "DOZ",
    "dosen": "DOZ",
    "lusin": "DOZ",
    # Liter
    "liter": "LTR",
    "litre": "LTR",
    "ltr": "LTR",
    # Sheet / Lembar
    "sheet": "LBR",
    "sht": "LBR",
    "lbr": "LBR",
    "lembar": "LBR",
    # Length: one bar or pipe as cut (6 m pipe, 4 m bar), not a metre
    "lgh": "LGH",
    "length": "LGH",
    # Carton
    "c/t": "BOX",
    "carton": "BOX",
    # Coil
    "c/l": "RLS",
    # Day
    "hari": "DAY",
    # Reviewed, no closer master code
    "bag": "OTH",
    "sack": "OTH",
    "karung": "OTH",
    "vol": "OTH",
    "pail": "OTH",
    "ream": "OTH",
    "rim": "OTH",
    "strip": "OTH",
    "stip": "OTH",
    "tab": "OTH",
    "caps": "OTH",
    "amp": "OTH",  # ampoule, not ampere
    "cyl": "OTH",
    "pad": "OTH",
    "m3": "OTH",
    "ball": "OTH",
    "gen": "OTH",
    "titik": "OTH",
}


def map_unit(raw: str | None) -> tuple[str | None, bool]:
    """Return (code, mapped). An unknown unit falls back to OTH, unmapped."""
    if raw is None:
        return None, False
    key = str(raw).replace("\xa0", " ").strip().lower()
    # A count typed with the unit ("1 PCS") names the unit all the same.
    key = re.sub(r"^\d+(?:[.,]\d+)?\s+", "", key)
    if not key:
        return None, False
    if key in UNIT_MAP:
        return UNIT_MAP[key], True
    return "OTH", False


def canonical_unit(raw: str | None) -> str | None:
    """Return canonical unit code; None if input empty, OTH if unmapped."""
    return map_unit(raw)[0]
