"""Map raw Excel unit strings to canonical unit codes in `units` master."""

from __future__ import annotations

import re
from functools import cache
from pathlib import Path

# The app's vocabulary: units and their aliases (migrations 00109 and
# 00111), read from the master seed so the import and the app resolve every
# spelling to the same unit.
MASTER_SEED = Path(__file__).resolve().parent.parent / "seeds" / "01_master.sql"

# Reviewed spellings with no unit of their own, checked before the seed.
# Each is OTH on purpose: the old files use "amp" for an ampoule, never the
# Ampere code, and the rest name containers the catalog has no unit for.
IMPORT_OVERRIDES: dict[str, str] = {
    "AMP": "OTH",
    "BAG": "OTH",
    "SACK": "OTH",
    "KARUNG": "OTH",
    "VOL": "OTH",
    "REAM": "OTH",
    "RIM": "OTH",
    "STRIP": "OTH",
    "STIP": "OTH",
    "TAB": "OTH",
    "CAPS": "OTH",
    "CYL": "OTH",
    "PAD": "OTH",
    "M3": "OTH",
    "BALL": "OTH",
    "GEN": "OTH",
    "TITIK": "OTH",
}

_CODE_ROW = re.compile(r"\(\s*(?:\d+|NULL)\s*,\s*'([^']+)'\s*,\s*'[^']*'\s*,\s*'UM\.\d{4}'\s*\)")
_ALIAS_ROW = re.compile(r"\('([^']+)',\s*'([^']+)'\)")


def normalize(raw: str) -> str:
    """Normalise as fn_unit_text does."""
    text = re.sub(r"\s+", " ", raw.replace("\xa0", " ").upper()).strip()
    return re.sub(r"\.+$", "", text).strip()


@cache
def seed_vocabulary() -> tuple[frozenset[str], dict[str, str]]:
    """Unit codes and alias to code, from the master seed."""
    sql = MASTER_SEED.read_text(encoding="utf-8")
    units_block = sql.split("CREATE TEMP TABLE seed_units", 1)[1].split(";", 2)[1]
    codes = frozenset(_CODE_ROW.findall(units_block))
    alias_block = sql.split("-- Unit aliases", 1)[1].split("ON CONFLICT", 1)[0]
    aliases = {normalize(alias): code for alias, code in _ALIAS_ROW.findall(alias_block)}
    if not codes or not aliases:
        raise RuntimeError(f"no units or aliases read from {MASTER_SEED}")
    return codes, aliases


def map_unit(raw: str | None) -> tuple[str | None, bool]:
    """Return (code, mapped). An unknown unit falls back to OTH, unmapped."""
    if raw is None:
        return None, False
    key = normalize(str(raw))
    # A count typed with the unit ("1 PCS") names the unit all the same.
    key = re.sub(r"^\d+(?:[.,]\d+)?\s+", "", key)
    if not key:
        return None, False
    if key in IMPORT_OVERRIDES:
        return IMPORT_OVERRIDES[key], True
    codes, aliases = seed_vocabulary()
    if key in codes:
        return key, True
    if key in aliases:
        return aliases[key], True
    return "OTH", False


def canonical_unit(raw: str | None) -> str | None:
    """Return canonical unit code; None if input empty, OTH if unmapped."""
    return map_unit(raw)[0]
