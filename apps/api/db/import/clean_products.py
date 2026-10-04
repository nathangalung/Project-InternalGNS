"""Build the clean product master from the staged quotation lines.

Reads out/staged.json (written by parse.py) and writes out/products.json
(one canonical item per product, with the lines it came from) and
out/review_products.csv (everything a person should look at, with a reason).

Rules (survey report, product quality section 10; plan decisions win):

- Name source: the offer text when the line was offered, else the client's
  request. An offer that is only a note on the request ("Brand Tekiro
  8x150mm", "Impa 650878 (30m)") keeps the request as the name and the note
  in the description. Nama Asli is not used: it is the supplier's listing
  and is often misaligned with its row.
- Structure: the name is one line; the remaining lines are the description.
  Catalogue prose after a wide gap, "IMPA nnnnnn" mentions, order and request
  note lines and heading lines are stripped; pack sizes go to pack_note.
  Names stay our own cleaned text; no catalogue text is fetched.
- Comparison key (matching only): NFKC, lowercase, decimal comma, synonyms
  and the spelling fixes seen in the corpus (SYNONYMS), numbers glued to
  their units, punctuation dropped, stop words dropped. It covers the name
  and the description, so a size on a second line still counts.
- Tiers: lines sharing a validated IMPA code are one product unless the
  text contradicts the code (text too different, another kind, disjoint
  numbers, variant words both sides state). Contradicting lines split off
  and lose the code; with no product on most of the code's lines the code
  is left off every line. All of these are flagged. Identical keys (or
  identical sorted-token keys) merge when every guard passes. Fuzzy
  candidates (token_sort >= 90, or ratio >= 92 on the space-free key)
  that pass every guard go to review; they never merge.
- Guards: numbers, part numbers, variant words, short tokens, IMPA codes
  and item kinds. A union never puts two IMPA codes in one item.
- IMPA: a valid cell is used; a code written as "IMPA nnnnnn" fills an
  empty cell; a cell that disagrees with the text, an invalid cell and a
  bare six-digit number in brackets give no code and a review row.
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field, replace
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from rapidfuzz import fuzz, process

from paths import OUT_DIR, OVERRIDES_FILE
from values import IMPA_SECTIONS, impa_codes_in_text, is_no_offer, parse_impa

Record = dict[str, Any]
Text = tuple[str, str | None, str | None, str | None]
Ref = tuple[str, int]

OVERRIDES = OVERRIDES_FILE

TOKEN_SORT_MIN = 90
FLAT_RATIO_MIN = 92
IMPA_TEXT_MIN = 60
HEADING_MIN = 90
LAYOUT_GAP = 4
LONG_NAME = 120

# Name cleanup

_INVISIBLE = re.compile("[\u200b\u200c\u200d\u2060\ufeff]")
_SPACE_ENTITY = re.compile(r"&n(?:bs|sb)p;?", re.IGNORECASE)
_BULLET = re.compile("^\\s*['\u2018\u2019]?[-\u2013\u2022*]\\s+")
_IMPA_MENTION = re.compile(
    "[ \\t]*[-\u2013,:;]?"
    r"[ \t]*\(?\bIMPA\s*(?:code\s*)?[:#.\-]?\s*\d{6}\b\)?,?",
    re.IGNORECASE,
)
_BARE_CODE = re.compile(r"\((\d{6})\)")
_WIDE_GAP = re.compile(r"\s{2,}")
# An uppercase catalogue line, then a sentence on one space
_GLUED_PROSE = re.compile(r"^([^a-z]{12,}?) ([A-Z][a-z]+ [a-z].*)$")
_NOTE_LINE = re.compile(
    r"^(min\.?\s*order|note\s*:|pre-?order|request\b|price per|qty\s*:"
    r"|\(?\s*(available|ready|only\s+\d|made to order|limited stock)\b"
    r"|\(?\d+(\s*-\s*\d+)?\s*(working\s+)?days?\)?$|delivery time|(including|incl\.?)\s+delivery"
    r"|franco\b)",
    re.IGNORECASE,
)
_ECHO_LINE = re.compile(r"^request\b\s*", re.IGNORECASE)
_NOTE_LABEL = re.compile(r"^(request|note\s*:)\s*", re.IGNORECASE)
_LABEL = re.compile("^(alternative|alternatif|offer)\\s*:\\s*[-\u2013]?\\s*", re.IGNORECASE)
_PACK_LINE = re.compile(
    r"^(per box|isi \d|\d+ pack =|\d+\s*(strip|blister|sachet)s?\s+\d+\s*\w+$)", re.IGNORECASE
)
_INLINE_NOTE = re.compile(
    r"\s*\((only\s+\d+|ready|available|\d+\s*(working\s+)?days?|made to order)[^)]*\)"
    r"|\s+(-\s*)?(min\.?\s*order|note\s*:|pre-?order|price per|made to order|limited stock"
    r"|only\s+\d+\s+available|available\s+\d)\b.*$",
    re.IGNORECASE,
)
_INLINE_PACK = re.compile(
    r"\s*\(?\b(\d+\s*)?(box|dus|pack|pak|ctn)\s+isi\s+\d+\s*[a-z]*\)?"
    r"|\s*\bper\s+(box|dus|pack)\s*=\s*\d+\s*[a-z]*",
    re.IGNORECASE,
)
_TRAILING_QTY = re.compile(r"\s+-\s*(\d+\s*(pcs|pc|set|unit|ea|buah)\.?)\s*$", re.IGNORECASE)
_OFFER_NOTE = re.compile(r"^\s*(brand|merk|merek|impa\s*[:#.\-]?\s*\d{6}|offer\s*:)", re.IGNORECASE)


@dataclass(frozen=True)
class Cleaned:
    """A line's product text after cleanup."""

    name: str
    description: str | None
    pack_note: str | None
    lines: tuple[str, ...]
    notes: tuple[str, ...] = ()
    echo: tuple[str, ...] = ()

    @property
    def text(self) -> str:
        """All kept lines, in source order, for matching."""
        return "\n".join(self.lines)

    @property
    def note(self) -> str | None:
        """Order and request notes, kept but never matched."""
        return "; ".join(self.notes) or None


def _clean_line(line: str) -> list[str]:
    """Cut catalogue prose; a layout gap of four spaces or more breaks the line."""
    line = _LABEL.sub("", _BULLET.sub("", line).strip())
    m = _GLUED_PROSE.match(line)
    if m and _is_prose(m.group(2)):
        line = m.group(1)
    parts = _WIDE_GAP.split(line)
    gaps = _WIDE_GAP.findall(line)
    out = [parts[0]]
    for seg, gap in zip(parts[1:], gaps, strict=True):
        if _is_prose(seg):
            break
        if len(gap) >= LAYOUT_GAP:
            out.append(seg)
        else:
            out[-1] = f"{out[-1]} {seg}"
    return [seg.strip(" ,;") for seg in out]


_FUNCTION_WORDS = frozenset(
    {"the", "a", "an", "is", "are", "of", "for", "to", "and", "with", "on", "in", "as", "be"}
    | {"by", "from", "which", "that", "it", "this", "these", "or", "can", "used"}
)


def _is_prose(seg: str) -> bool:
    """Catalogue prose after a wide gap: a sentence or label, not a spec."""
    words = seg.split()
    if not words or not seg[0].isalpha():
        return False
    if seg.rstrip().endswith((".", ":")):
        return True
    lower = sum(w.isalpha() and w.islower() for w in words)
    function = sum(w.lower() in _FUNCTION_WORDS for w in words)
    return len(words) >= 8 and (lower >= 0.75 * len(words) or function >= 0.25 * len(words))


def _is_heading(line: str, nxt: str) -> bool:
    a, b = line.lower(), nxt.lower()
    return len(a) <= len(b) and fuzz.partial_ratio(a, b) >= HEADING_MIN


def _is_group_heading(first: str, second: str) -> bool:
    """IMPA RFQ shape: a group label above the coded short description."""
    return (
        not any(ch.isdigit() for ch in first)
        and not first.isupper()
        and second.isupper()
        and len(second.split()) >= 3
    )


def _join_brackets(s: str) -> list[str]:
    """Rejoin a cell line broken inside brackets by the line that closes them."""
    out: list[str] = []
    for ln in s.split("\n"):
        if out and out[-1].count("(") > out[-1].count(")") and ")" in ln:
            out[-1] = f"{out[-1].rstrip()} {ln.strip()}"
        else:
            out.append(ln)
    return out


def clean_text_block(raw: str, rfq: bool = False, note: str | None = None) -> Cleaned:
    """Split raw product text into a one-line name, a description and notes.

    rfq: the first line is the client's own, so an IMPA RFQ group heading
    there moves behind the coded short description. note: an offer note
    kept with the notes.
    """
    s = _SPACE_ENTITY.sub(" ", _INVISIBLE.sub("", raw))
    s = unicodedata.normalize("NFKC", s).replace("\r", "\n")
    s = _IMPA_MENTION.sub(" ", s)
    lines: list[str] = []
    packs: list[str] = []
    notes: list[str] = []
    echo: list[str] = []
    for line in (seg for ln in _join_brackets(s) for seg in _clean_line(ln)):
        while m := _INLINE_NOTE.search(line):
            found = m.group(0).strip(" -")
            notes.append(found[1:-1] if found.startswith("(") else found)
            line = line[: m.start()] + line[m.end() :]
        m = _INLINE_PACK.search(line)
        if m and m.start() > 0:
            packs.append(m.group(0).strip(" ()"))
            line = (line[: m.start()] + line[m.end() :]).strip(" ,;")
        m = _TRAILING_QTY.search(line)
        if m:
            packs.append(m.group(1))
            line = line[: m.start()]
        line = line.strip(" ,;")
        if not line:
            continue
        if _PACK_LINE.match(line):
            packs.append(line)
        elif _NOTE_LINE.match(line):
            text = _NOTE_LABEL.sub("", line)
            if text:
                notes.append(text)
            if _ECHO_LINE.match(line):
                echo.append(text)
        else:
            lines.append(line)
    lines = [
        ln for i, ln in enumerate(lines) if i + 1 >= len(lines) or not _is_heading(ln, lines[i + 1])
    ]
    if not lines:
        lines = notes or [re.sub(r"\s+", " ", raw).strip() or "?"]
        notes, echo = [], []
    order = list(lines)
    if rfq and len(order) >= 2 and _is_group_heading(order[0], order[1]):
        order = [order[1], *order[2:], order[0]]
    name, rest = order[0], order[1:]
    return Cleaned(
        name=name,
        description="\n".join(rest) or None,
        pack_note="; ".join(packs) or None,
        lines=tuple(lines),
        notes=(*notes, note) if note else tuple(notes),
        echo=tuple(echo),
    )


# Comparison key

_UNITS = (
    "mm|cm|km|m|in|kg|mg|g|ml|l|w|kw|kva|v|vac|vdc|a|mah|ah|hp|pk|bar|psi|hz|ton|t|rpm|s|pcs|lbs|oz"
)
SYNONYMS: list[tuple[str, str]] = [
    (r"\bo[\s-]?rings?\b", "oring"),
    (r"\bv[\s-]?belts?\b", "vbelt"),
    (r"(\d)\s*(?:inch(?:es)?|inc|\"|''|\u201d|\u2033)", r"\1in"),
    (r"\b(?:inch(?:es)?|inc)\b", "in"),
    (r"(\d)\s*(?:grams?|grm|gr|gram)\b", r"\1g"),
    (r"\bmillimet(?:er|re)s?\b", "mm"),
    (r"(\d)\s*(?:met(?:er|re)s?|mtrs?)\b", r"\1m"),
    (r"(\d)\s*(?:amps?|ampere)\b", r"\1a"),
    (r"(\d)\s*kgs\b", r"\1kg"),
    (r"(\d)\s*(?:lit(?:er|re)s?|ltrs?)\b", r"\1l"),
    (r"\bvac+um\b", "vacuum"),
    (r"\blenght\b", "length"),
    # Corpus spelling fixes
    (r"\bbat+e?r+a?y\b", "battery"),
    (r"\bselenoid\b", "solenoid"),
    (r"\balumi?n(?:i|u)?um\b", "aluminium"),
]
_SYNONYMS = [(re.compile(p), r) for p, r in SYNONYMS]
_GLUE = re.compile(rf"(\d)\s+({_UNITS})\b")
_DIM = re.compile(rf"(\d(?:{_UNITS})?)\s*[x*\u00d7]\s*(?=\d)")
STOP_WORDS = frozenset(
    {"merk", "merek", "brand", "offer", "type", "size", "ukuran", "with", "dengan", "for"}
    | {"untuk", "dan", "and", "pcs", "set", "isi"}
)
_LINE_SIGN = re.compile(r"(?:^|\s)([+-])\s*$")
_SIGN = re.compile(r"\(\s*([+-])\s*\)|(?:^|(?<=\s))(\+)(?=\s|$)")


def _sign_word(m: re.Match[str]) -> str:
    """Screwdriver tips: (+) or a lone + is plus, (-) or a line-final - is minus."""
    sign = next(g for g in m.groups() if g)
    return " plus " if sign == "+" else " minus "


def comparison_key(text: str) -> str:
    """Normalise product text for matching; never shown."""
    s = unicodedata.normalize("NFKC", text).lower()
    s = "\n".join(_LINE_SIGN.sub(_sign_word, _SIGN.sub(_sign_word, ln)) for ln in s.split("\n"))
    s = re.sub(r"(\d),(\d)", r"\1.\2", s)
    s = re.sub("['\u2019`]", "", s)
    for pat, rep in _SYNONYMS:
        s = pat.sub(rep, s)
    s = _GLUE.sub(r"\1\2", s)
    s = _DIM.sub(r"\1x", s)
    s = re.sub(r"[^a-z0-9./+\-\s]", " ", s)
    tokens = [t.strip("./+-") for t in s.split()]
    return " ".join(t for t in tokens if t and t not in STOP_WORDS)


# Guards


def _words(spec: str) -> frozenset[str]:
    return frozenset(spec.split())


def _group(spec: str) -> dict[str, str]:
    """Parse "canon=alias alias, other" into word -> canonical value."""
    out: dict[str, str] = {}
    for entry in spec.split(","):
        canon, _, aliases = entry.strip().partition("=")
        for word in (canon, *aliases.split()):
            out[word] = canon
    return out


VARIANT_GROUPS: dict[str, dict[str, str]] = {
    "colour": _group(
        "red=merah, green=hijau, black=hitam, white=putih, blue=biru, yellow=kuning, cyan,"
        " magenta, orange=oranye, brown=coklat cokelat, grey=gray abu, silver, gold, pink,"
        " purple=ungu, clear=bening transparan transparent"
    ),
    "gender": _group("male, female"),
    "inside": _group("internal, external"),
    "hand": _group("left=lh kiri, right=rh kanan"),
    "side": _group("port, stb=starboard, fwd=forward, aft=stern"),
    "gas": _group("oxygen=oksigen, lpg, acetylene=asetilin, argon"),
    "apparel": _group("s, m, l, xl, xxl, xxxl, ll"),
    "cell": _group("aa, aaa"),
    "negation": _group("not=without tanpa non"),
    "tip": _group("plus=phillips, minus=slotted"),
    "count": _group("single, double, triple"),
    "valve": _group("angle, globe, gate, check, ball, butterfly"),
    "galv": _group("galv=galvanized galvanised, ungalv=ungalvanized ungalvanised"),
    "material": _group("brass=kuningan, stainless=ss sus, pvc, nylon, steel"),
    "condition": _group("used=bekas refurbished second rekondisi"),
    "country": _group(
        "indonesia, india, china, singapore, malaysia, japan, korea, germany, france, italy,"
        " netherlands, panama, liberia, philippines, vietnam, thailand, australia, england,"
        " uk, usa, america, taiwan, norway, denmark, greece"
    ),
}
_VARIANT_OF = {w: (g, v) for g, words in VARIANT_GROUPS.items() for w, v in words.items()}
_SHORT_IGNORE = STOP_WORDS | _words(
    "a an the of to in on at by or no nr x per ke di yg utk ex mm cm km kg mg g ml l w kw"
    " v hp pk bar psi hz ton t rpm s lbs oz pc ea"
)
_NUMBER = re.compile(r"\d+(?:\.\d+)?")
_MEASURE = re.compile(rf"^[\d.]+(?:{_UNITS})?(?:x[\d.]+(?:{_UNITS})?)*(?:/[a-z]+)?$")

_SERVICE = re.compile(
    r"^\W*(transport|delivery|shipping|pengiriman|ongkos|ongkir|jasa|kalibrasi|calibration"
    r"|biaya|cargo\s+(fee|bandara|charges?|to|service)|freight|air\s*freight|airfreight"
    r"|sea\s*freight|trucking"
    r"|boat\s+(to|charges?|hire|rent)|service(?!\s+kit))\b",
    re.IGNORECASE,
)
_MEDICINE = re.compile(
    r"\b(tablets?|kapsul|capsules?|sirup|syrup|salep|ointment|obat|injeksi|injection"
    r"|amoxicillin|paracetamol|antasida)\b|\b\d+(?:[.,]\d+)?\s*mg\b",
    re.IGNORECASE,
)
_PUBLICATION = re.compile(
    r"\b(publications?|edition|ed\.?\s*20\d\d|peta laut|admiralty|marpol|imdg|imsbc|iamsar"
    r"|solas consolidated|(log|record|order|bell)\s*book|nautical tables|buku tabel"
    r"|instruction manual)\b",
    re.IGNORECASE,
)


def item_kind(text: str) -> str:
    """Classify product text as service, medicine, publication or product."""
    if _SERVICE.match(text):
        return "service"
    if _MEDICINE.search(text):
        return "medicine"
    if _PUBLICATION.search(text):
        return "publication"
    return "product"


@dataclass(frozen=True)
class Features:
    """What the guards compare."""

    key: str
    sorted_key: str
    flat_key: str
    numbers: tuple[str, ...]
    parts: frozenset[str]
    variants: tuple[tuple[str, frozenset[str]], ...]
    shorts: frozenset[str]
    kind: str
    marks: frozenset[str] = frozenset()

    @property
    def identity(self) -> tuple[object, ...]:
        """What splits lines into variants: the key plus what notes add."""
        return (self.key, self.parts, self.variants, self.marks)


def _num(s: str) -> str:
    if re.fullmatch(r"\d{1,3}(?:\.\d{3})+", s):
        s = s.replace(".", "")
    try:
        return format(Decimal(s).normalize(), "f")
    except InvalidOperation:
        return s


def _part(token: str) -> str:
    return re.sub(r"[-./]", "", token).replace("o", "0")


_WORD_PAIR = re.compile(r"[a-z]{2,}(?:/[a-z]{2,})+")


def _parts(tokens: list[str]) -> frozenset[str]:
    return frozenset(
        _part(t)
        for t in tokens
        if re.search(r"[a-z]", t) and re.search(r"\d", t) and not _MEASURE.match(t)
    )


def _variant_groups(tokens: list[str]) -> dict[str, set[str]]:
    groups: dict[str, set[str]] = defaultdict(set)
    for t in tokens:
        for w in t.split("/") if _WORD_PAIR.fullmatch(t) else (t,):
            if w in _VARIANT_OF:
                g, v = _VARIANT_OF[w]
                groups[g].add(v)
    return groups


def features(
    text: str, echo: tuple[str, ...] = (), marks: frozenset[str] = frozenset()
) -> Features:
    """Compute the guard features of cleaned product text.

    Request echoes ("REQUEST kiri") add only their variant words and part
    numbers; codes a line carried but could not use (marks) must match too.
    """
    key = comparison_key(text)
    tokens = key.split()
    extra = comparison_key("\n".join(echo)).split()
    groups = _variant_groups(tokens + extra)
    return Features(
        key=key,
        sorted_key=" ".join(sorted(set(tokens))),
        flat_key=key.replace(" ", ""),
        numbers=tuple(sorted(_num(n) for n in _NUMBER.findall(key))),
        parts=_parts(tokens) | _parts(extra),
        variants=tuple(sorted((g, frozenset(v)) for g, v in groups.items())),
        shorts=frozenset(
            t
            for t in re.split(r"[\s./-]+", key)
            if re.fullmatch(r"[a-z]{1,3}", t) and t not in _SHORT_IGNORE
        ),
        kind=item_kind(text),
        marks=marks,
    )


def _variant_map(f: Features) -> dict[str, frozenset[str]]:
    return dict(f.variants)


def blocking_guard(
    a: Features, b: Features, code_a: str | None = None, code_b: str | None = None
) -> str | None:
    """Return the first guard that blocks merging a and b, or None."""
    if code_a and code_b and code_a != code_b:
        return "impa"
    if a.marks != b.marks:
        return "impa_marks"
    if a.kind != b.kind:
        return "item_kind"
    spacing_only = a.flat_key == b.flat_key
    if not spacing_only and a.numbers != b.numbers:
        return "numbers"
    if not spacing_only and a.parts != b.parts:
        return "part_numbers"
    va, vb = _variant_map(a), _variant_map(b)
    if any(va.get(g, frozenset()) != vb.get(g, frozenset()) for g in set(va) | set(vb)):
        return "variant_words"
    if not spacing_only and a.shorts != b.shorts:
        return "short_tokens"
    return None


def impa_guard(a: Features, b: Features) -> str | None:
    """What keeps two texts under one code apart, or None.

    A shared code lowers only the text bar: every hard guard still runs,
    and the texts must reach token_sort IMPA_TEXT_MIN (never token_set).
    """
    guard = blocking_guard(a, b)
    if guard is None and fuzz.token_sort_ratio(a.key, b.key) < IMPA_TEXT_MIN:
        return "text"
    return guard


# IMPA per line


@dataclass(frozen=True)
class Issue:
    """A finding on one line that needs a human look."""

    reason: str
    detail: str
    value: str | None = None


# Placeholders typed into an empty IMPA cell
_BLANK_CELLS = frozenset({"0", "-"})

# Survey 3b, 3e, 3f: (code, text must match, text pattern, reason)
IMPA_CHECKS: list[tuple[str, bool, str, str]] = [
    ("650878", True, r"sounding", "survey 3f: verified online as a 30 m sounding tape"),
    (r"794[23]\d\d", False, r"nyyhy", "survey 3e: a halogen-free marine cable, not NYYHY"),
    (r"61473\d", False, r"amplas", "survey 3e: emery tape 50mm x 36.5m, another spec"),
    ("233843", False, r"\bd\b", "survey 3e: a straight eye-bolt shackle, not a D shackle"),
    ("510801", False, r"plasti", "survey 3e: a corn broom, not a plastic one"),
    ("614054", False, r"weld|\blas\b|\brods?\b|electrode", "survey 3f: a hose band code"),
    ("851116", False, r"majun|\brags?\b", "survey 3f: a welding helmet code"),
]
# Head noun to IMPA section, kept short
SECTION_RULES: list[tuple[str, frozenset[str], str]] = [
    (
        r"^(?:hex(?:agon)?\s+head\s+)?(?:bolts?|baut)\b|^mur\s+baut\b",
        frozenset({"69"}),
        "bolts and nuts are section 69",
    ),
    (
        r"^(?:kawat\s+las|welding\s+(?:rods?|electrodes?)|electrodes?)\b",
        frozenset({"85"}),
        "welding consumables are section 85",
    ),
    (r"^(?:shackles?|segel)\b", frozenset({"23"}), "shackles are section 23"),
]


# Machinery and power equipment never carries a packing and jointing code
# (section 81), and a publication never a protective clothing one (31).
_MACHINE = re.compile(r"compressor|kompresor|trafo|transformer|generator|genset", re.IGNORECASE)


def impa_check(code: str, name: str, text: str) -> str | None:
    """Why a valid code cannot stand on this product text, or None."""
    lower = text.lower()
    for pattern, must, words, reason in IMPA_CHECKS:
        if re.fullmatch(pattern, code) and bool(re.search(words, lower)) is not must:
            return reason
    for head, sections, reason in SECTION_RULES:
        if re.match(head, name.strip().lower()) and code[:2] not in sections:
            return f"{reason}, not {code[:2]}"
    if code[:2] == "81" and _MACHINE.search(name):
        return "section 81 is packing and jointing, not machinery"
    if code[:2] == "31" and item_kind(name) == "publication":
        return "section 31 is protective clothing, not publications"
    return None


# A size, or a chain of them sharing the unit ("305x3x25,4mm").
_SIZE = re.compile(
    r"((?:\d+(?:[.,]\d+)?\s*[x*]\s*)*\d+(?:[.,]\d+)?)\s*"
    r"(mm|cm|mtrs?|meters?|m|ltrs?|liters?|litres?|l|kgs?|ml|inch|\"|tons?)\b",
    re.IGNORECASE,
)
_SIZE_UNIT = {"mtr": "m", "mtrs": "m", "meter": "m", "meters": "m", "ltr": "l", "ltrs": "l",
              "liter": "l", "liters": "l", "litre": "l", "litres": "l", "kgs": "kg",
              "inch": '"', "tons": "ton"}  # fmt: skip


def _sizes(text: str) -> dict[str, set[float]]:
    """Sizes on the first line that names any, by unit: {"mm": {125.0}}.

    An RFQ group heading ("Calipers Outside") above the spec names none,
    so the spec line is the one read; catalogue prose further down is not.
    """
    for line in text.strip().split("\n"):
        out: dict[str, set[float]] = defaultdict(set)
        for chain, unit in _SIZE.findall(line):
            u = unit.lower()
            for value in re.split(r"\s*[x*]\s*", chain.lower()):
                out[_SIZE_UNIT.get(u, u)].add(float(value.replace(",", ".")))
        if out:
            return out
    return {}


def request_code_check(line: Record, code: str, name_text: str) -> str | None:
    """Why the client's request code cannot stand on the product GNS offered.

    The code in the IMPA cell belongs to the client's request. When the
    offered product measures otherwise in a unit both name (a 150 mm
    caliper for a 125 mm request, a 25 l pail for a 150 l drum), the code
    is the request's, not the product's.
    """
    request = line.get("request") or ""
    if code != line.get("impa") or not request or name_text.strip() == request.strip():
        return None
    asked, offered = _sizes(request), _sizes(name_text)
    for unit in sorted(asked.keys() & offered.keys()):
        if not asked[unit] & offered[unit]:
            want = ", ".join(f"{v:g}{unit}" for v in sorted(asked[unit]))
            got = ", ".join(f"{v:g}{unit}" for v in sorted(offered[unit]))
            return f"the request asks for {want}, the offer is {got}"
    return None


@dataclass(frozen=True)
class LineImpa:
    """A line's confident code, its issues and the codes it could not use."""

    code: str | None
    issues: tuple[Issue, ...] = ()
    marks: frozenset[str] = frozenset()


def line_impa(line: Record) -> LineImpa:
    """Return the confident IMPA code of a staged line and any issues.

    When the cell and the text disagree, or the text names several codes,
    no code is used and every code seen becomes a mark: two lines whose
    marks differ are never one product.
    """
    cell: str | None = line.get("impa")
    texts = [t for t in (line.get("request"), line.get("offer")) if t]
    in_text: list[str] = list(line.get("impa_in_text") or [])
    for t in texts:
        for c in impa_codes_in_text(t):
            if c not in in_text:
                in_text.append(c)
    issues: list[Issue] = []
    if line.get("impa_problem") and str(line.get("impa_raw")).strip() not in _BLANK_CELLS:
        raw = str(line.get("impa_raw"))
        detail = f"IMPA cell {raw!r} is not a code ({line['impa_problem']})"
        issues.append(Issue("impa_invalid", detail, raw))
        cell = None
    if cell and in_text and cell not in in_text:
        issues.append(Issue("impa_text_differs", f"cell {cell}, text {', '.join(in_text)}"))
        return LineImpa(None, tuple(issues), frozenset({cell, *in_text}))
    if cell:
        return LineImpa(cell, tuple(issues))
    if len(set(in_text)) == 1:
        return LineImpa(in_text[0], tuple(issues))
    if len(set(in_text)) > 1:
        issues.append(Issue("impa_text_differs", f"text names {', '.join(in_text)}"))
        return LineImpa(None, tuple(issues), frozenset(in_text))
    for t in texts:
        for c in _BARE_CODE.findall(t):
            if c[:2] in IMPA_SECTIONS:
                issues.append(Issue("impa_unconfirmed_in_text", f"{c} in brackets without IMPA"))
                return LineImpa(None, tuple(issues))
    return LineImpa(None, tuple(issues))


# Lines to variants


@dataclass(frozen=True)
class Source:
    """Where a line's product text comes from."""

    text: str
    note: str | None = None
    rfq: bool = True


_PLACEHOLDER = re.compile(
    r"^\s*(please\s+(provide|advise|confirm)|to\s+be\s+confirm(ed)?|tb[acd]\b|n/a\b|idem\b"
    r"|same\s+as\s+(request|above))",
    re.IGNORECASE,
)
_LEAD_CODE = re.compile(r"^\s*(\d{6})\b[\s,:;-]*")
_PACK_OFFER = re.compile(
    r"^\s*\d+\s*(strip|box|dus|pack|pak|botol|btl|tube|sachet|blister)s?\b", re.IGNORECASE
)


def _alpha(text: str) -> set[str]:
    return {t for t in comparison_key(text).split() if re.fullmatch(r"[a-z]{3,}", t)}


def _is_fragment(offer: str, request: str) -> bool:
    """A two-word offer naming nothing the request names ("DOUBLE WALL")."""
    return (
        len(offer.split()) <= 2
        and len(_alpha(request)) >= 4
        and not _alpha(offer) & set(comparison_key(request).split())
    )


def _first_line(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().split("\n")[0]).casefold()


def line_source(line: Record) -> Source:
    """The text a line's product name comes from.

    The offer, unless it was not made, is a placeholder ("please provide
    details", "To be Confirm", kept as a note), or only qualifies the
    request: a brand or IMPA note, a bare code, a pack size or a two-word
    fragment. Then the request is the name and the offer, if it adds
    anything, its description. rfq is set when the text's first line is
    the client's own, so an RFQ group heading may move behind it.
    """
    request = (line.get("request") or "").strip()
    offer = (line.get("offer") or "").strip()
    if not re.search(r"[A-Za-z0-9]", offer):
        offer = ""
    if not line.get("available", True) or not offer or is_no_offer(offer):
        return Source(request or offer)
    if not request:
        return Source(offer, rfq=False)
    if _PLACEHOLDER.match(offer):
        return Source(request, note=offer)
    m = _LEAD_CODE.match(offer)
    if m and m.group(1)[:2] in IMPA_SECTIONS:
        offer = offer[m.end() :]
    elif not (
        (_OFFER_NOTE.match(offer) and not _OFFER_NOTE.match(request))
        or _PACK_OFFER.match(offer)
        or _is_fragment(offer, request)
    ):
        return Source(offer, rfq=_first_line(offer) == _first_line(request))
    added = set(comparison_key(_IMPA_MENTION.sub(" ", offer)).split())
    if added <= set(comparison_key(request).split()):
        return Source(request)
    return Source(f"{request}\n{offer}")


@dataclass
class Variant:
    """Lines with one comparison key and one IMPA code."""

    key: str
    impa: str | None
    feats: Features
    names: Counter[Text] = field(default_factory=Counter)
    refs: list[tuple[str, int]] = field(default_factory=list)
    units: Counter[str] = field(default_factory=Counter)
    unmapped: set[str] = field(default_factory=set)
    issues: set[tuple[str, str]] = field(default_factory=set)
    rejected: set[str] = field(default_factory=set)
    invalid_raw: set[str] = field(default_factory=set)
    requests: Counter[Features] = field(default_factory=Counter)
    label: int | None = None

    @property
    def weight(self) -> int:
        return len(self.refs)

    @property
    def quotes(self) -> set[str]:
        return {q for q, _ in self.refs}


def is_credit(line: Record) -> bool:
    """A trade-in credit or other negative row: never a product."""
    return (line.get("sell") or 0) < 0 or (line.get("line_total") or 0) < 0


def _variants(
    quotations: list[Record],
    labels: dict[Ref, int] | None = None,
    codes: dict[Ref, str | None] | None = None,
) -> tuple[list[Variant], int, set[str]]:
    """Group lines by identity; labels and codes are override decisions."""
    labels, codes = labels or {}, codes or {}
    by_key: dict[tuple[object, str | None, int | None], Variant] = {}
    raw_names: set[str] = set()
    request_feats: dict[str, Features] = {}
    n_lines = 0
    for q in quotations:
        for line in q.get("lines") or []:
            if is_credit(line):
                continue
            n_lines += 1
            ref = (q["id"], line["line_no"])
            src = line_source(line)
            raw_names.add(re.sub(r"\s+", " ", src.text).strip().lower())
            li = line_impa(line)
            code, issues = li.code, li.issues
            c = clean_text_block(src.text, rfq=code is not None and src.rfq, note=src.note)
            suspect = code and impa_check(code, c.name, c.text)
            if code and suspect:
                issues = (*issues, Issue("impa_suspect", f"code {code}: {suspect}"))
            elif code and (differs := request_code_check(line, code, c.text)):
                suspect = differs
                issues = (*issues, Issue("impa_request_differs", f"code {code}: {differs}"))
            used = codes.get(ref, None if suspect else code)
            offered = [x for x in impa_codes_in_text(line.get("offer")) if x != used]
            if offered:
                # A code the offer names but the product cannot take still
                # tells sizes apart ("PTFE Impa 810385" and "810386").
                extra = "IMPA " + "/".join(offered)
                c = replace(c, description=f"{c.description}\n{extra}" if c.description else extra)
            f = features(c.text, c.echo, li.marks)
            key = (f.identity, used, labels.get(ref))
            v = by_key.get(key)
            if v is None:
                v = by_key[key] = Variant(key=f.key, impa=used, feats=f, label=key[2])
            if code and code != used:
                v.rejected.add(code)
            v.names[(c.name, c.description, c.pack_note, c.note)] += 1
            v.refs.append(ref)
            request = line.get("request") or ""
            if request not in request_feats:
                request_feats[request] = features(clean_text_block(request).text)
            v.requests[request_feats[request]] += 1
            if line.get("unit"):
                v.units[line["unit"]] += 1
            if line.get("unit_raw") and not line.get("unit_mapped"):
                v.unmapped.add(str(line["unit_raw"]))
            v.issues.update((i.reason, i.detail) for i in issues)
            v.invalid_raw.update(i.value for i in issues if i.value is not None)
    return list(by_key.values()), n_lines, raw_names


# Clustering


class _Clusters:
    """Union-find with the item rules built in.

    A union never joins two IMPA codes, never puts two differently keyed
    variants of one quotation in one item (a client lists distinct
    products on distinct lines), and checks the hard guards against every
    member, not just the pair that matched (complete linkage).
    """

    def __init__(self, variants: list[Variant]) -> None:
        self.variants = variants
        self.parent = list(range(len(variants)))
        self.codes: list[set[str]] = [{v.impa} if v.impa else set() for v in variants]
        self.members: list[list[int]] = [[i] for i in range(len(variants))]
        self.keys: list[dict[str, str]] = [dict.fromkeys(v.quotes, v.key) for v in variants]
        self.labels: list[int | None] = [v.label for v in variants]

    def find(self, i: int) -> int:
        while self.parent[i] != i:
            self.parent[i] = self.parent[self.parent[i]]
            i = self.parent[i]
        return i

    def code_conflict(self, i: int, j: int) -> bool:
        ci, cj = self.codes[self.find(i)], self.codes[self.find(j)]
        return bool(ci and cj and ci != cj)

    def same_quotation(self, i: int, j: int) -> bool:
        """True when i and j hold different lines of one quotation."""
        ki, kj = self.keys[self.find(i)], self.keys[self.find(j)]
        small, big = sorted((ki, kj), key=len)
        return any(q in big and big[q] != k for q, k in small.items())

    def guard(self, i: int, j: int) -> str | None:
        """The first rule that keeps i's item and j's item apart."""
        if self.code_conflict(i, j):
            return "impa"
        if self.same_quotation(i, j):
            return "same_quotation"
        if self.labels[self.find(i)] != self.labels[self.find(j)]:
            return "override_split"
        for a in self.members[self.find(i)]:
            for b in self.members[self.find(j)]:
                g = blocking_guard(self.variants[a].feats, self.variants[b].feats)
                if g is not None:
                    return g
        return None

    def union(self, i: int, j: int, force: bool = False) -> bool:
        ri, rj = self.find(i), self.find(j)
        if ri == rj or self.code_conflict(ri, rj):
            return False
        if not force and self.guard(ri, rj) is not None:
            return False
        self.parent[rj] = ri
        self.codes[ri] |= self.codes[rj]
        self.members[ri] += self.members[rj]
        self.keys[ri].update(self.keys[rj])
        if self.labels[ri] is None:
            self.labels[ri] = self.labels[rj]
        return True


@dataclass
class _Pending:
    reason: str
    a: int
    b: int | None
    score: float | None
    detail: str


@dataclass
class Catalog:
    """The clean product master, its review sheet and counts."""

    products: list[Record]
    review: list[Record]
    stats: dict[str, Any]
    members: dict[Any, list[tuple[Features, tuple[tuple[str, int], ...]]]] = field(
        default_factory=dict
    )


def _impa_tier(variants: list[Variant], uf: _Clusters, pending: list[_Pending]) -> tuple[int, int]:
    """Join lines under one code; split codes holding different products."""
    by_code: dict[str, list[int]] = defaultdict(list)
    for i, v in enumerate(variants):
        if v.impa:
            by_code[v.impa].append(i)
    merges = conflicting = 0
    for code, idxs in sorted(by_code.items()):
        idxs.sort(key=lambda i: (-variants[i].weight, variants[i].key))
        groups: list[list[int]] = []
        for i in idxs:
            best = max(
                (g for g in groups if _impa_block(variants, g, i) is None),
                key=lambda g: fuzz.token_sort_ratio(variants[g[0]].key, variants[i].key),
                default=None,
            )
            if best is None:
                groups.append([i])
            else:
                best.append(i)
        if len(groups) > 1:
            conflicting += 1
            groups = _rank_holders(variants, groups, idxs)
            tie = _holder_score(variants, groups[0], idxs) == _holder_score(
                variants, groups[1], idxs
            )
            for g in groups if tie else groups[1:]:
                for i in g:
                    variants[i].impa = None
                    variants[i].rejected.add(code)
                    uf.codes[i].discard(code)
            if tie:
                none = (
                    f"code {code} names {len(groups)} different products and the requests"
                    " favour none; left off"
                )
                pending.extend(_Pending("impa_split", g[0], None, None, none) for g in groups)
                continue
            keep = groups[0][0]
            for g in groups[1:]:
                why = _impa_block(variants, groups[0], g[0])
                split = f"code {code} stays with the other item ({why}); this one lost it"
                pending.append(_Pending("impa_split", g[0], keep, None, split))
        main = groups[0]
        for i in main[1:]:
            merges += uf.union(main[0], i)
    return merges, conflicting


def _impa_block(variants: list[Variant], group: list[int], i: int) -> str | None:
    """What keeps variant i out of a group under one code (complete linkage)."""
    v = variants[i]
    for m in group:
        other = variants[m]
        if any(q in other.quotes for q in v.quotes) and other.key != v.key:
            return "same_quotation"
        if other.label != v.label:
            return "override_split"
        guard = impa_guard(other.feats, v.feats)
        if guard is not None:
            return guard
    return None


def _holder_score(
    variants: list[Variant], group: list[int], idxs: list[int]
) -> tuple[int, float, int]:
    """How well a group fits the requests written against its code.

    The client wrote the code against its request, so the group matching
    the most requests (every guard passing) keeps it, even with fewer
    lines: an offered substitute such as NYYHY for an HF-CXO request never
    wins on volume. Next comes the closest text to any of those requests
    (token_sort), and only then the line count.
    """
    requests = [(rf, n) for i in idxs for rf, n in variants[i].requests.items()]
    support = sum(
        n for rf, n in requests if any(blocking_guard(rf, variants[m].feats) is None for m in group)
    )
    closeness = max(
        fuzz.token_sort_ratio(rf.key, variants[m].key) for rf, _ in requests for m in group
    )
    return support, round(closeness, 1), sum(variants[i].weight for i in group)


def _rank_holders(
    variants: list[Variant], groups: list[list[int]], idxs: list[int]
) -> list[list[int]]:
    return sorted(groups, key=lambda g: tuple(-x for x in _holder_score(variants, g, idxs)))


def _join_earlier(
    variants: list[Variant], uf: _Clusters, pending: list[_Pending], i: int, earlier: list[int]
) -> int:
    """Join i to the first earlier variant every guard allows."""
    for j in earlier:
        if uf.find(i) == uf.find(j):
            return 0
        if blocking_guard(variants[j].feats, variants[i].feats) is not None:
            continue
        if uf.code_conflict(j, i):
            codes = ", ".join(sorted(uf.codes[uf.find(j)] | uf.codes[uf.find(i)]))
            pending.append(_Pending("same_name_different_impa", j, i, 100.0, f"codes {codes}"))
            continue
        if uf.union(j, i):
            return 1
    return 0


def _identical_tier(variants: list[Variant], uf: _Clusters, pending: list[_Pending]) -> int:
    """Merge identical keys when every guard passes."""
    merges = 0
    for attr in ("key", "sorted_key"):
        buckets: dict[str, list[int]] = defaultdict(list)
        for i, v in enumerate(variants):
            buckets[getattr(v.feats, attr)].append(i)
        for idxs in buckets.values():
            for pos, i in enumerate(idxs):
                merges += _join_earlier(variants, uf, pending, i, idxs[:pos])
    return merges


def _fuzzy_tier(
    variants: list[Variant], uf: _Clusters, pending: list[_Pending]
) -> tuple[int, Counter[str]]:
    """Queue guarded fuzzy matches for review; they never merge."""
    keys = [v.feats.key for v in variants]
    flats = [v.feats.flat_key for v in variants]
    scores: dict[tuple[int, int], float] = {}
    for choices, scorer, cutoff in (
        (keys, fuzz.token_sort_ratio, TOKEN_SORT_MIN),
        (flats, fuzz.ratio, FLAT_RATIO_MIN),
    ):
        for i, query in enumerate(choices):
            for _, score, j in process.extract(
                query, choices, scorer=scorer, score_cutoff=cutoff, limit=None
            ):
                if j > i:
                    scores[(i, j)] = max(scores.get((i, j), 0.0), float(score))
    blocked: Counter[str] = Counter()
    seen: dict[tuple[int, int], int] = {}
    candidates = 0
    for (i, j), score in sorted(scores.items()):
        ri, rj = uf.find(i), uf.find(j)
        if ri == rj:
            continue
        candidates += 1
        a, b = variants[i], variants[j]
        guard = blocking_guard(a.feats, b.feats, a.impa, b.impa) or uf.guard(i, j)
        if guard is not None:
            blocked[guard] += 1
            continue
        pair = (min(ri, rj), max(ri, rj))
        if pair in seen and (pending[seen[pair]].score or 0) >= score:
            continue
        row = _Pending("fuzzy_match", i, j, round(score, 1), "similar text; every guard passes")
        if pair in seen:
            pending[seen[pair]] = row
        else:
            seen[pair] = len(pending)
            pending.append(row)
    return candidates, blocked


# Overrides


OVERRIDE_ACTIONS = ("merge", "split", "set_impa", "rename")


@dataclass
class _Override:
    n: int
    action: str
    record: Record
    refs: list[Ref]


def _resolve_overrides(
    overrides: list[Record], known: set[Ref]
) -> tuple[list[_Override], list[Record]]:
    """Validate each override against the staged lines; report the rest."""
    good: list[_Override] = []
    bad: list[Record] = []
    for n, rec in enumerate(overrides, start=1):
        action = rec.get("action")
        try:
            refs = [(str(q), int(ln)) for q, ln in rec.get("lines") or []]
        except (TypeError, ValueError):
            refs = []
        missing = [r for r in refs if r not in known]
        problem = None
        if action not in OVERRIDE_ACTIONS:
            problem = f"unknown action {action!r}"
        elif not refs:
            problem = "no lines"
        elif missing:
            problem = f"lines not in the staged data: {missing}"
        elif action == "merge" and len(set(refs)) < 2:
            problem = "a merge needs two lines"
        elif action == "set_impa" and rec.get("impa") is not None:
            if parse_impa(rec.get("impa"))[0] is None:
                problem = f"{rec.get('impa')!r} is not an IMPA code"
        elif action == "rename" and not rec.get("name"):
            problem = "a rename needs a name"
        if problem:
            bad.append({"n": n, "refs": refs, "detail": f"override {n}: {problem}"})
        else:
            good.append(_Override(n, str(action), rec, refs))
    return good, bad


def _line_rules(overrides: list[_Override]) -> tuple[dict[Ref, int], dict[Ref, str | None]]:
    """Split labels and IMPA codes per line, set before any tier runs."""
    labels: dict[Ref, int] = {}
    codes: dict[Ref, str | None] = {}
    for o in overrides:
        for r in o.refs:
            if o.action == "split":
                labels[r] = o.n
            elif o.action == "set_impa":
                codes[r] = parse_impa(o.record.get("impa"))[0]
    return labels, codes


def _apply_merges(
    overrides: list[_Override], where: dict[Ref, int], uf: _Clusters, bad: list[Record]
) -> int:
    merges = 0
    for o in overrides:
        if o.action != "merge":
            continue
        first, *rest = (where[r] for r in o.refs)
        for i in rest:
            if uf.code_conflict(first, i):
                detail = f"override {o.n}: the lines hold two IMPA codes; set one first"
                bad.append({"n": o.n, "refs": o.refs, "detail": detail})
                break
            merges += uf.union(first, i, force=True)
    return merges


# Output


def _canonical(members: list[Variant]) -> Text:
    names: Counter[Text] = Counter()
    coded: set[Text] = set()
    for v in members:
        names.update(v.names)
        if v.impa:
            coded.update(v.names)
    return min(names, key=lambda n: (-names[n], n not in coded, n[0].lower(), n[1] or ""))


def _disambiguate(products: list[Record]) -> None:
    """Name products that share a heading after what sets them apart.

    A catalogue heading ("Butterfly valve double flange") is the name of
    several products whose size or type sits in the description, so they
    look alike in every list. Each takes the first description line on
    which the group differs ("... - WCB 10K 12\" (300A)"); a product with
    no description keeps the heading.
    """
    groups: dict[str, list[Record]] = defaultdict(list)
    for p in products:
        groups[p["name"].strip().lower()].append(p)
    for group in groups.values():
        lines = [(p["description"] or "").split("\n") for p in group]
        if len(group) < 2 or len({tuple(ls) for ls in lines}) < 2:
            continue
        depth = max(len(ls) for ls in lines)
        at = next(
            (i for i in range(depth) if len({ls[i] if i < len(ls) else "" for ls in lines}) > 1),
            None,
        )
        for p, ls in zip(group, lines, strict=True):
            detail = ls[at].strip() if at is not None and at < len(ls) else ""
            if detail:
                p["name"] = f"{p['name']} - {detail}"


def _display(name: Text) -> str:
    return " ".join([name[0], *(name[1] or "").split("\n")]).strip()


def _item_id(refs: list[Ref]) -> str:
    """Stable id: a hash of the item's first source line."""
    q, n = refs[0]
    return "P" + hashlib.sha1(f"{q}\x00{n}".encode()).hexdigest()[:10]


def build_products(quotations: list[Record], overrides: list[Record] | None = None) -> Catalog:
    """Cluster staged lines into canonical products and a review list.

    overrides (overrides.json) are a person's decisions on review rows,
    keyed by source lines: merge, split, set_impa and rename.
    """
    known = {(q["id"], ln["line_no"]) for q in quotations for ln in q.get("lines") or []}
    ovr, bad = _resolve_overrides(overrides or [], known)
    variants, n_lines, raw_names = _variants(quotations, *_line_rules(ovr))
    variants.sort(key=lambda v: (v.key, v.impa or "", v.label or 0))
    where = {r: i for i, v in enumerate(variants) for r in v.refs}
    codes_seen = {v.impa for v in variants if v.impa}
    suspect = {c for v in variants for c in v.rejected}
    uf = _Clusters(variants)
    pending: list[_Pending] = []
    impa_merges, conflicting = _impa_tier(variants, uf, pending)
    auto_merges = _identical_tier(variants, uf, pending)
    forced = _apply_merges(ovr, where, uf, bad)
    candidates, blocked = _fuzzy_tier(variants, uf, pending)

    clusters: dict[int, list[int]] = defaultdict(list)
    for i in range(len(variants)):
        clusters[uf.find(i)].append(i)
    renames = {uf.find(where[o.refs[0]]): o.record for o in ovr if o.action == "rename"}
    by_root: dict[int, Record] = {}
    for root, idxs in clusters.items():
        members = [variants[i] for i in idxs]
        name = _canonical(members)
        codes = sorted({v.impa for v in members if v.impa})
        units: Counter[str] = Counter()
        for v in members:
            units.update(v.units)
        refs = sorted(r for v in members for r in v.refs)
        texts = {_display(n) for v in members for n in v.names}
        kinds = Counter(v.feats.kind for v in members)
        record: Record = {
            "id": _item_id(refs),
            "name": name[0],
            "description": name[1],
            "pack_note": name[2],
            "notes": name[3],
            "impa_code": codes[0] if codes else None,
            "kind": kinds.most_common(1)[0][0],
            "default_unit": min(units, key=lambda u: (-units[u], u)) if units else None,
            "units": dict(sorted(units.items(), key=lambda kv: (-kv[1], kv[0]))),
            "line_count": len(refs),
            "source_lines": [{"quotation": q, "line_no": n} for q, n in refs],
            "merged_from": sorted(texts - {_display(name)}),
            "rejected_impa": sorted({c for v in members for c in v.rejected}),
        }
        if root in renames:
            rename = renames[root]
            record["name"] = rename["name"]
            if "description" in rename:
                record["description"] = rename["description"]
            record["merged_from"] = sorted(
                texts - {_display((record["name"], record["description"], None, None))}
            )
        by_root[root] = record
    _disambiguate(list(by_root.values()))
    products = sorted(
        by_root.values(),
        key=lambda p: (p["name"].lower(), p["impa_code"] or "", p["id"]),
    )

    decided: dict[Ref, list[str]] = defaultdict(list)
    for o in ovr:
        for r in o.refs:
            decided[r].append(f"override {o.n}: {o.action}")

    def side(i: int, whole: bool) -> tuple[Record, list[Ref], str]:
        item = by_root[uf.find(i)]
        if whole:
            refs = [(s["quotation"], s["line_no"]) for s in item["source_lines"]]
            return item, refs, _display((item["name"], item["description"], None, None))
        v = variants[i]
        return (
            item,
            sorted(v.refs),
            _display(min(v.names, key=lambda n: (-v.names[n], _display(n)))),
        )

    review: list[Record] = []
    seen: set[tuple[str, str, str, str]] = set()

    def add(
        reason: str,
        a: int,
        b: int | None,
        score: float | None,
        detail: str,
        whole: bool = False,
    ) -> None:
        pa, la, ta = side(a, whole)
        pb, lb, tb = side(b, whole) if b is not None else (None, [], "")
        if pb is not None and pb["id"] == pa["id"]:
            return
        if pb is not None and reason == "fuzzy_match" and pb["id"] < pa["id"]:
            pa, la, ta, pb, lb, tb = pb, lb, tb, pa, la, ta
        k = (reason, pa["id"], pb["id"] if pb else "", detail)
        if k in seen:
            return
        seen.add(k)
        decision = sorted({d for r in la + lb for d in decided.get(r, [])})
        review.append(
            {
                "reason": reason,
                "item_id": pa["id"],
                "item_name": pa["name"],
                "impa_code": pa["impa_code"] or "",
                "lines": [list(r) for r in la],
                "text": ta,
                "other_item_id": pb["id"] if pb else "",
                "other_item_name": pb["name"] if pb else "",
                "other_impa_code": (pb["impa_code"] or "") if pb else "",
                "other_lines": [list(r) for r in lb],
                "other_text": tb,
                "score": score,
                "line_count": pa["line_count"],
                "detail": detail,
                "decision": "; ".join(decision),
            }
        )

    for p in pending:
        add(p.reason, p.a, p.b, p.score, p.detail)
    for i, v in enumerate(variants):
        for reason, detail in sorted(v.issues):
            add(reason, i, None, None, detail)
        if v.unmapped:
            add(
                "unit_unmapped",
                i,
                None,
                None,
                f"units {', '.join(sorted(v.unmapped))} map to OTH",
            )
    for root, idxs in clusters.items():
        p = by_root[root]
        if len({variants[i].key for i in idxs}) > 1:
            texts = sorted({_display(n) for i in idxs for n in variants[i].names})
            add("merged_texts_differ", root, None, None, " | ".join(texts), whole=True)
        if len(p["units"]) > 1:
            units = ", ".join(f"{u} x{c}" for u, c in p["units"].items())
            add("mixed_units", root, None, None, units, whole=True)
        if p["default_unit"] is None:
            add("no_unit", root, None, None, "no line carries a unit", whole=True)
        if len(p["name"].split()) == 1 and not p["description"] and not re.search(r"\d", p["name"]):
            add("generic_name", root, None, None, "one word, no description", whole=True)
        if len(p["name"]) > LONG_NAME:
            add(
                "long_name",
                root,
                None,
                None,
                f"{len(p['name'])} characters",
                whole=True,
            )
        if p["name"].startswith("#"):
            add("excel_error_name", root, None, None, f"name {p['name']!r}", whole=True)
    review.extend(
        dict.fromkeys(REVIEW_COLUMNS, "")
        | {"reason": "override_invalid", "lines": [list(r) for r in o["refs"]]}
        | {"detail": o["detail"], "score": None, "line_count": None}
        for o in bad
    )
    reasons: dict[str, set[str]] = defaultdict(set)
    for r in review:
        for item_id in (r["item_id"], r["other_item_id"]):
            reasons[item_id].add(r["reason"])
    for p in products:
        p["review"] = sorted(reasons[p["id"]])
    review.sort(
        key=lambda r: (
            r["reason"],
            r["item_name"],
            r["item_id"],
            r["other_item_id"],
            r["detail"],
        )
    )

    invalid = {raw for v in variants for raw in v.invalid_raw}
    stats: dict[str, Any] = {
        "lines": n_lines,
        "raw_distinct_names": len(raw_names),
        "variants": len(variants),
        "canonical_items": len(products),
        "impa_merges": impa_merges,
        "auto_merges": auto_merges,
        "override_merges": forced,
        "fuzzy_candidates": candidates,
        "blocked_by_guard": dict(sorted(blocked.items())),
        "review_rows": len(review),
        "review_by_reason": dict(sorted(Counter(r["reason"] for r in review).items())),
        "impa_codes_seen": len(codes_seen | suspect),
        "impa_codes_valid": len({p["impa_code"] for p in products if p["impa_code"]}),
        "impa_values_invalid": len(invalid),
        "impa_codes_conflicting": conflicting,
        "impa_codes_suspect": len(suspect),
        "kinds": dict(sorted(Counter(p["kind"] for p in products).items())),
    }
    members = {
        by_root[root]["id"]: [(variants[i].feats, tuple(variants[i].refs)) for i in idxs]
        for root, idxs in clusters.items()
    }
    return Catalog(products=products, review=review, stats=stats, members=members)


REVIEW_COLUMNS = [
    "reason", "item_id", "item_name", "impa_code", "lines", "text",
    "other_item_id", "other_item_name", "other_impa_code", "other_lines", "other_text",
    "score", "line_count", "detail", "decision",
]  # fmt: skip


def _cell(v: object) -> object:
    if v is None:
        return ""
    if isinstance(v, list):
        return json.dumps(v, ensure_ascii=False) if v else ""
    return v


def write_outputs(cat: Catalog, out_dir: Path) -> None:
    """Write products.json and review_products.csv."""
    out_dir.mkdir(parents=True, exist_ok=True)
    doc = {"stats": cat.stats, "products": cat.products}
    (out_dir / "products.json").write_text(
        json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    with (out_dir / "review_products.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=REVIEW_COLUMNS, lineterminator="\n")
        w.writeheader()
        for r in cat.review:
            w.writerow({k: _cell(r[k]) for k in REVIEW_COLUMNS})


def main() -> int:
    staged = OUT_DIR / "staged.json"
    if not staged.is_file():
        print(f"{staged} is missing; run parse.py first", file=sys.stderr)
        return 1
    data = json.loads(staged.read_text(encoding="utf-8"))
    overrides = json.loads(OVERRIDES.read_text(encoding="utf-8")) if OVERRIDES.is_file() else []
    cat = build_products(data["quotations"], overrides)
    write_outputs(cat, OUT_DIR)
    print(json.dumps(cat.stats, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
