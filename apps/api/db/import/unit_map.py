"""Map raw Excel unit strings to canonical unit codes in `units` master."""
from __future__ import annotations


# Maps lowercased raw → canonical CODE in DB units.code.
# Codes match seed file 01_master.sql.
UNIT_MAP: dict[str, str] = {
    # PCS family
    "pcs": "PCS",
    "pc": "PCS",
    # SET family
    "set": "SET",
    # BOX family
    "box": "BOX",
    "dus": "BOX",
    # BTL
    "btl": "BTL",
    # KG family
    "kg": "KG",
    "kgs": "KG",
    # Meter family
    "m": "MTR",
    "mtr": "MTR",
    "meter": "MTR",
    "lgh": "MTR",  # "length"
    # Roll family
    "roll": "RLS",
    "rls": "RLS",
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
    "c/t": "TIN",
    # Tube
    "tub": "TUB",
    # Pair
    "prs": "PRS",
    "pair": "PRS",
    # Dozen
    "doz": "DOZ",
    "dozen": "DOZ",
    "dzn": "DOZ",
    # Liter
    "liter": "LTR",
    "ltr": "LTR",
    # Sheet / Lembar
    "sheet": "LBR",
    "sht": "LBR",
    "lbr": "LBR",
    # Misc → fallback
    "bag": "OTH",
    "vol": "OTH",
    "pail": "OTH",
    "ream": "OTH",
}


def canonical_unit(raw: str | None) -> str | None:
    """Return canonical unit code; None if input empty or unmapped."""
    if not raw:
        return None
    key = str(raw).strip().lower()
    return UNIT_MAP.get(key, "OTH")
