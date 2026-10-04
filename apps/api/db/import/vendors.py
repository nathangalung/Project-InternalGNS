"""Vendor names, merge keys and contact details from the source cells.

A DATA ENTRI vendor cell names one shop, or several on their own lines:
the first is the shop the line was priced at, the rest are alternatives.
Lines that are a shop's address or a note in brackets are not shops. The
Telp column next to it holds a marketplace, a phone number or a place.

Two spellings are one vendor when their merge keys agree: letters and
digits only, without a legal form, an honorific, a marketplace or place
suffix, with Tehnik read as Teknik. Pairs the rules cannot decide are
merged only by an owner decision in local/vendor_overrides.json, each with
its reason; the rest go to the review sheet.
"""

from __future__ import annotations

import csv
import json
import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from rapidfuzz import fuzz

Doc = dict[str, object]

ADDRESS_LINE = re.compile(r"\b(lt|blok|jl|jln|no)\b\.?\s*[a-z]?\d", re.IGNORECASE)
# Shops in one cell sit on their own lines, in wide gaps, or after / , &.
SEPARATOR = re.compile(r"\n|\s{3,}|\s*/\s*|,\s+|\s+&\s+")
QTY_NOTE = re.compile(r"\s+(-\s+)?\d+\s*(pcs|pc|set|unit)\b.*$", re.IGNORECASE)
TRAILING_NOTE = re.compile(r"\s*\([^)]*\)?\s*$")
NEW_TAG = re.compile(r"[_\s]new$", re.IGNORECASE)
HONORIFIC = re.compile(r"^\s*(?:(?:bapak|bpk|pak|ibu|bu|koh)\b\.?|bp\.)\s*", re.IGNORECASE)
LEGAL = re.compile(r"^\s*(pt|cv|ud|tb|tk)(\.|\s)\s*|[\s,]+(tbk|pt)\.?\s*$", re.IGNORECASE)
MARKETPLACES = ("toped", "tokped", "tokopedia", "shopee", "shoppe", "bukalapak", "lazada")
PLACES = (
    "LTC Glodok",
    "Glodok",
    "Jatiwaringin",
    "Cilegon",
    "Bekasi",
    "Mangga Dua",
    "ManggaDua",
    "Pinangsia",
    "Batam",
    "Surabaya",
    "Bandung",
    "Sidoarjo",
    "Tangerang",
    "Bogor",
    "Depok",
    "Jakarta",
    "Jakbar",
    "Jakut",
    "Jaksel",
    "Jakpus",
    "Jaktim",
    "SBY",
)
_M = "|".join(MARKETPLACES)
_P = "|".join(re.escape(p) for p in PLACES)
SUFFIX = re.compile(
    rf"\s*[-\u2013]\s*(?:(?:{_M})(?:\s+(?:{_P}))?|(?:{_P}))\s*$"
    rf"|\s+(?:{_M}|official(?:\s+store)?)\s*$",
    re.IGNORECASE,
)
PHONE = re.compile(r"(?:\+?62|0)?8[\d\s-]{7,14}\d")


def _place(text: str) -> str | None:
    for p in PLACES:
        if text.casefold() == p.casefold():
            return "Mangga Dua" if p == "ManggaDua" else p
    return None


@dataclass
class Cell:
    """One vendor cell: the priced shop, its alternatives, place and phones."""

    name: str | None
    alternatives: list[str] = field(default_factory=list)
    location: str | None = None
    phones: list[str] = field(default_factory=list)


def phones_in(text: str | None) -> list[str]:
    """Phone numbers of 9 to 12 digits, as typed."""
    found: list[str] = []
    for m in PHONE.finditer(text or ""):
        number = " ".join(m.group(0).split())
        if 9 <= len(re.sub(r"\D", "", number)) <= 12 and number not in found:
            found.append(number)
    return found


def shop_name(text: str) -> str:
    """A shop without a quantity, a phone or a note in brackets."""
    for phone in phones_in(text):
        text = text.replace(phone, " ")
    text = TRAILING_NOTE.sub("", QTY_NOTE.sub("", text))
    return " ".join(text.split()).strip(" -")


def split_cell(raw: str | None) -> Cell:
    """The shops a vendor cell names, the first being the one priced."""
    cell = Cell(None)
    shops: list[str] = []
    address: list[str] = []
    for piece in SEPARATOR.split(re.sub(r"\([^)]*\)", "\n", raw or "")):
        text = piece.strip()
        if not text or text.startswith("("):
            continue
        cell.phones += [p for p in phones_in(text) if p not in cell.phones]
        if ADDRESS_LINE.search(text):
            address.append(text)
            continue
        if place := _place(text):
            cell.location = cell.location or place
            continue
        name = shop_name(text)
        if name and name.casefold() not in MARKETPLACES and name not in shops:
            shops.append(name)
    cell.name = shops[0] if shops else None
    cell.alternatives = shops[1:]
    if address:
        cell.location = " ".join(address)
    return cell


def display_name(name: str) -> tuple[str, str | None]:
    """A shop name without a trailing marketplace or place, and that place."""
    m = SUFFIX.search(name)
    if not m or m.start() == 0:
        return name, None
    words = (w.strip() for w in re.findall(r"[\w ]+", m.group(0)))
    place = next((p for p in map(_place, words) if p), None)
    return name[: m.start()].strip(), place


def merge_key(name: str) -> str:
    """Letters and digits of a vendor name, without the parts spellings vary in."""
    text = name
    for _ in range(3):
        text = SUFFIX.sub("", HONORIFIC.sub("", LEGAL.sub("", NEW_TAG.sub("", text))))
    text = re.sub(r"tehnik|tekhnik", "teknik", text, flags=re.IGNORECASE)
    return re.sub(r"[\W_]+", "", text.casefold())


def channel_details(raw: str | None) -> tuple[list[str], str | None]:
    """Phone numbers and the place a Telp cell names."""
    place = None
    for p in PLACES:
        if re.search(rf"\b{re.escape(p)}\b", raw or "", re.IGNORECASE):
            place = "Mangga Dua" if p == "ManggaDua" else p
            break
    return phones_in(raw), place


@dataclass
class Decisions:
    """Owner merge decisions: merge key to the key it joins, with reasons."""

    into: dict[str, str] = field(default_factory=dict)
    names: dict[str, str] = field(default_factory=dict)
    reasons: dict[str, str] = field(default_factory=dict)

    def key(self, name: str) -> str:
        k = merge_key(name)
        return self.into.get(k, k)


def load_decisions(path: Path) -> Decisions:
    """local/vendor_overrides.json, or no decisions when it is absent."""
    d = Decisions()
    if not path.is_file():
        return d
    for m in json.loads(path.read_text(encoding="utf-8")).get("merge") or []:
        target = merge_key(m["into"])
        d.names[target] = m["into"]
        for n in m["names"]:
            if merge_key(n) != target:
                d.into[merge_key(n)] = target
                d.reasons[merge_key(n)] = m["reason"]
    return d


def review_pairs(names: dict[str, Counter[str]], threshold: float = 88) -> list[Doc]:
    """Vendors whose keys look alike but no rule or decision joined."""
    keys = sorted(names)
    rows: list[Doc] = []
    for i, a in enumerate(keys):
        for b in keys[i + 1 :]:
            score = fuzz.ratio(a, b)
            short, long_ = sorted((a, b), key=len)
            contained = len(short) >= 6 and short in long_ and score >= 60
            if score >= threshold or contained:
                rows.append(
                    {
                        "vendor_a": names[a].most_common(1)[0][0],
                        "vendor_b": names[b].most_common(1)[0][0],
                        "score": round(score, 1),
                        "reason": "contained" if contained else "similar",
                    }
                )
    return rows


def write_review(rows: list[Doc], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["vendor_a", "vendor_b", "score", "reason"])
        w.writeheader()
        w.writerows(rows)
