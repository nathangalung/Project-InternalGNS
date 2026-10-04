"""Workbook discovery and file-name parsing.

File names carry the quotation number, the client's request reference,
the vessel, a topic, and the client, in a loose
`Q-NNN (ref - topic - vessel) - client - note.xlsx` shape. They are the
only source of the reference and vessel for many workbooks.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path


def discover(root: Path) -> list[Path]:
    """Return every .xlsx under root, recursively, in path order."""
    return sorted(p for p in root.rglob("*.xlsx") if p.is_file())


def name_exclusion(name: str) -> str | None:
    """Return why a file is skipped by its name alone, or None."""
    if name.startswith("~$"):
        return "lock file"
    if re.match(r"template\b", name, re.IGNORECASE):
        return "template"
    return None


@dataclass
class FileName:
    """What a workbook's file name says about its quotation."""

    number: str | None = None
    suffix: str | None = None
    refs: list[str] = field(default_factory=list)
    parts: list[str] = field(default_factory=list)
    client_hint: str | None = None
    notes: list[str] = field(default_factory=list)
    markers: list[str] = field(default_factory=list)


# A request reference: Pelita V-/O- refs, IMC 8404 and NNN-E-MM-YY refs,
# MBSS PR refs, Transcoal TCP refs, and similar coded tokens.
_REF = re.compile(
    r"(?<![\w-])(?:TCP[\s-]?\d{4}-\d{4,5}"
    r"|(?:[VO][-_]\d{2}|R?\d|PR\d{2})[A-Za-z0-9]*(?:[-_.][A-Za-z0-9]+){2,})(?![\w-])"
)
_REVISION = re.compile(r"^(rev|revisi|revised|revision|requote)\b.*$", re.IGNORECASE)
_NUMBER = re.compile(r"^Q-?\s*(\d+)(?:-([A-Za-z0-9]{1,2}))?(?![A-Za-z0-9])")
_DASH_SPLIT = re.compile(r"\s+-\s*|\s*-\s+")
_REF_FILLER = {"NO", "NO.", "REQ", "REQ."}


def _is_ref(token: str) -> bool:
    if token.upper().startswith("TCP"):
        return True
    return (
        len(token) >= 9
        and bool(re.search(r"[A-Za-z]", token))
        and (len(re.findall(r"\d+", token)) >= 2)
    )


def _split_refs(text: str) -> tuple[list[str], str]:
    refs: list[str] = []

    def take(m: re.Match[str]) -> str:
        if _is_ref(m.group(0)):
            refs.append(m.group(0))
            return " "
        return m.group(0)

    rest = _REF.sub(take, text)
    return refs, re.sub(r"\s+", " ", rest).strip(" ,;")


def _parse_inner(inner: str, fn: FileName) -> None:
    for raw in _DASH_SPLIT.split(inner):
        refs, rest = _split_refs(raw.strip())
        fn.refs.extend(refs)
        if _REVISION.match(rest):
            fn.markers.append(rest)
        elif rest and rest.upper() not in _REF_FILLER:
            fn.parts.append(rest)


def _parse_tail(tail: str, fn: FileName) -> None:
    pieces = [p.strip() for p in _DASH_SPLIT.split(tail.strip().lstrip("-")) if p.strip()]
    if not pieces:
        return
    fn.client_hint = pieces[0]
    for p in pieces[1:]:
        (fn.markers if _REVISION.match(p) else fn.notes).append(p)


def _closing_paren(s: str, start: int) -> int | None:
    depth = 0
    for i in range(start, len(s)):
        if s[i] == "(":
            depth += 1
        elif s[i] == ")":
            depth -= 1
            if depth == 0:
                return i
    return None


def parse_file_name(name: str) -> FileName:
    """Split a quotation workbook's file name into its parts."""
    fn = FileName()
    stem = re.sub(r"\.xlsx$", "", name, flags=re.IGNORECASE)
    stem = re.sub(r"\.xlsb$", "", stem, flags=re.IGNORECASE)
    if stem.lower().endswith(".pdf"):
        stem = stem[:-4]
        fn.markers.append(".pdf.xlsx")
    for m in re.finditer(r"\((AutoRecovered|version \d+)\)", stem, re.IGNORECASE):
        fn.markers.append(m.group(1))
    stem = re.sub(r"\s*\((AutoRecovered|version \d+)\)", "", stem, flags=re.IGNORECASE)
    for m in re.finditer(r"\((\d)\)", stem):
        fn.markers.append(f"({m.group(1)})")
    stem = re.sub(r"\s*\(\d\)", "", stem).strip()

    m = _NUMBER.match(stem)
    if m is None:
        return fn
    fn.number, fn.suffix = m.group(1), m.group(2)
    if fn.suffix and (fn.suffix.upper() == "R" or fn.suffix.isdigit()):
        fn.markers.append(f"-{fn.suffix.upper()}")
    rest = stem[m.end() :].strip()

    lead = re.match(r"^(rev|revisi|revised)\b\s*", rest, re.IGNORECASE)
    if lead:
        fn.markers.append(lead.group(1))
        rest = rest[lead.end() :]
    rest = rest.lstrip("- ").strip()

    if rest.startswith("("):
        close = _closing_paren(rest, 0)
        if close is None:
            pieces = [p for p in _DASH_SPLIT.split(rest[1:]) if p.strip()]
            _parse_inner(" - ".join(pieces[:-1]), fn)
            _parse_tail(pieces[-1] if pieces else "", fn)
        else:
            _parse_inner(rest[1:close], fn)
            _parse_tail(rest[close + 1 :], fn)
        return fn

    pieces = [p.strip() for p in _DASH_SPLIT.split(rest) if p.strip()]
    if pieces:
        _parse_inner(" - ".join(pieces[:-1]), fn)
        _parse_tail(pieces[-1], fn)
    return fn
