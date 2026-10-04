"""Resolve copies, revisions and shared numbers across records.

- A revision sheet whose lines equal another client's record is a stale
  copy left in a workbook: it is dropped and listed on its workbook's
  record.
- Identical content (client, date, discount, lines) answering the same
  request is one quotation. The copy with the most evidence survives and
  every other copy stays on it as an alias (path, printed number,
  reference, vessel, terms), flagged where they differ. A print export
  whose printed grand total matches a record of the same number and date
  is a copy too.
- Records sharing a number for the same client and request with related
  lines form a revision chain ordered by date; a revision sheet always
  joins the DATA record its workbook bound it to.
- Anything else sharing a number stays separate and is flagged. Records
  answering one request with no line in common, and revisions filed
  under another number, are linked by related_to for the owner.
"""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from typing import Any

Record = dict[str, Any]

_COPY_MARKER = re.compile(r"\(\d\)|AutoRecovered|version \d+|\.pdf\.xlsx", re.IGNORECASE)


def _norm(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().upper())


def _markers(r: Record) -> list[str]:
    return list(r["file_name"].get("markers", []))


def _copy_marked(r: Record) -> bool:
    return any(_COPY_MARKER.fullmatch(m) for m in _markers(r))


def _sheet_marked(r: Record) -> bool:
    return any(m.startswith("sheet:") for m in _markers(r))


def _revision_marked(r: Record) -> bool:
    """A file name that says it is a revision (rev, revisi, -R, -2 ...)."""
    return any(not _COPY_MARKER.fullmatch(m) and not m.startswith("sheet:") for m in _markers(r))


# Lines


def _line_key(ln: Record) -> tuple[Any, ...]:
    sell = ln.get("sell")
    return (
        ln.get("qty"),
        _norm(ln.get("unit_raw")),
        _norm(ln.get("request")),
        _norm(ln.get("offer")),
        round(sell, 2) if isinstance(sell, int | float) else None,
        ln.get("available"),
    )


def _lines_fingerprint(r: Record) -> str:
    return json.dumps([_line_key(ln) for ln in r["lines"]], default=str)


def _tokens(s: str | None) -> set[str]:
    return set(re.findall(r"[A-Z0-9]+", _norm(s)))


def _offers_agree(a: Record, b: Record) -> bool:
    """Either offer is empty, they share a word, or the prices are close."""
    oa, ob = _tokens(a.get("offer")), _tokens(b.get("offer"))
    if not oa or not ob or any(len(t) >= 3 for t in oa & ob):
        return True
    sa, sb = a.get("sell"), b.get("sell")
    return bool(sa and sb and sa > 0 and sb > 0 and max(sa, sb) / min(sa, sb) <= 2)


def _same_line(a: Record, b: Record, fuzzy: bool) -> bool:
    if fuzzy:
        ta, tb = _tokens(a.get("request")), _tokens(b.get("request"))
        same = bool(ta and tb) and len(ta & tb) / len(ta | tb) >= 0.5
    else:
        ra = _norm(a.get("request"))[:60]
        same = bool(ra) and ra == _norm(b.get("request"))[:60]
    return same and _offers_agree(a, b)


def _shared(la: list[Record], lb: list[Record], fuzzy: bool) -> int:
    """How many lines pair up one to one."""
    used: set[int] = set()
    n = 0
    for x in la:
        for j, y in enumerate(lb):
            if j not in used and _same_line(x, y, fuzzy):
                used.add(j)
                n += 1
                break
    return n


def _offered(r: Record) -> list[Record]:
    return [ln for ln in r["lines"] if ln.get("available", True)] or r["lines"]


def similarity(a: Record, b: Record) -> float:
    """Jaccard share of the offered lines two records have in common.

    A line is shared when its request text matches and the offers agree,
    so a workbook reused for another offer under the old request text
    (a rag offered against a welding helmet request)
    does not match. Offered lines only, so two quotations that split one
    request between them (each offering what the other marks No Offer)
    do not match either.
    """
    la, lb = _offered(a), _offered(b)
    if not la or not lb:
        return 0.0
    n = _shared(la, lb, fuzzy=False)
    return n / (len(la) + len(lb) - n)


def _grown(a: Record, b: Record) -> bool:
    """One record keeps most of the other's lines and adds more (Q-499's
    19-line Q-502 grew to 35 lines, 15 of them kept)."""
    la, lb = _offered(a), _offered(b)
    n = _shared(la, lb, fuzzy=False)
    return n >= 2 and n >= 0.75 * min(len(la), len(lb))


def _common_line(a: Record, b: Record) -> bool:
    """Any line in common, allowing small text edits (80 10 to 80 12)."""
    return _shared(a["lines"], b["lines"], fuzzy=True) > 0


# Request references

# Reference formats that identify one client's requests.
_REF_FORMATS = {
    "voyage": r"[VO]\d{9}",
    "8404": r"8404",
    "requisition": r"\d{3}[A-Z]\d{4}$",
    "purchase request": r"PR\d",
    "transcoal": r"TCP\d",
}


def _ref_key(ref: str | None) -> str:
    """A reference as comparable text, or "" for a placeholder ("by WA").

    A leading R before the digits is a revision prefix (R8404/V/0021 is
    8404-V-0021).
    """
    key = re.sub(r"^R(?=\d)", "", re.sub(r"[^A-Z0-9]", "", _norm(ref)))
    return key if len(key) >= 5 and re.search(r"\d", key) else ""


def _ref_format(key: str) -> str | None:
    return next((f for f, p in _REF_FORMATS.items() if re.match(p, key)), None)


def _printed_ref(r: Record) -> str:
    """The printed reference, when it can decide whether two records match."""
    if r.get("client_ref_source") != "print":
        return ""
    if {"client_ref_foreign_format", "client_ref_conflicts_file_name"} & set(r["flags"]):
        return ""
    return _ref_key(r.get("client_ref"))


def _file_refs(r: Record) -> list[str]:
    if "file_name_describes_other_quotation" in r["flags"]:
        return []
    return list(r["file_name"].get("refs", []))


def _any_refs(r: Record) -> set[str]:
    keys = {_ref_key(x) for x in _file_refs(r)}
    keys.add(_printed_ref(r))
    return keys - {""}


def _mark_refs(records: list[Record]) -> None:
    """Flag printed references that cannot identify this record's request.

    A format one client uses for nine in ten of its references (Pelita's
    V-YY-NNNN-NNN-X) printed on another client's quotation was left over
    from a copied workbook; so was a printed reference the file name
    contradicts (a '-2' copy printing another request than its file name).
    """
    owners: dict[str, Counter[str]] = defaultdict(Counter)
    for r in records:
        key = _printed_ref(r)
        fmt = _ref_format(key) if key else None
        if fmt:
            owners[fmt][r["client"]["name"]] += 1
    dedicated = {}
    for fmt, clients in owners.items():
        client, n = clients.most_common(1)[0]
        if n >= 0.9 * sum(clients.values()):
            dedicated[fmt] = client
    for r in records:
        key = _printed_ref(r)
        if not key:
            continue
        fmt = _ref_format(key)
        if fmt in dedicated and r["client"]["name"] != dedicated[fmt]:
            r["flags"].append("client_ref_foreign_format")
            continue
        printed = _ref_digits(r["client_ref"])
        file_digits = {_ref_digits(x) for x in _file_refs(r)} - {""}
        if file_digits and not any(
            d.startswith(printed) or printed.startswith(d) for d in file_digits
        ):
            r["flags"].append("client_ref_conflicts_file_name")


def _ref_digits(ref: str | None) -> str:
    """The digits of a reference without zeros, so 012/D/3/2024 and
    012_D_03_2024, or PR01-2601-0001 and PR01-2601-001, agree."""
    return re.sub(r"[^1-9]", "", ref or "")


def _sheet_vessel(r: Record) -> str:
    return _norm(r["vessel"]) if r.get("vessel_source") in ("print", "data") else ""


def same_request(a: Record, b: Record) -> bool:
    """Whether two records can answer the same client request.

    Two usable printed references decide on their own, since a copied
    workbook can keep a stale vessel line; otherwise two known vessels
    must agree. A missing reference or vessel never rules a match out.
    """
    ra, rb = _printed_ref(a), _printed_ref(b)
    if ra and rb:
        return ra == rb
    va, vb = _sheet_vessel(a), _sheet_vessel(b)
    return not va or not vb or va == vb


def fingerprint(r: Record) -> str:
    """Content identity of a record, apart from its number and request."""
    d = r["discount"]
    return json.dumps(
        [
            r["client"]["name"],
            r["date"],
            d["kind"],
            d["pct"],
            d["amount"],
            _lines_fingerprint(r),
        ],
        default=str,
    )


def _digits(number: str | None) -> str | None:
    m = re.match(r"^Q-?\s*(\d+)", number or "")
    return m.group(1) if m else None


def _year(r: Record) -> int | None:
    if r.get("date"):
        return int(r["date"][:4])
    return r.get("year")


# Copies


def _evidence(r: Record) -> int:
    """How much a record proves on its own: reference, vessel, costs, totals."""
    totals = r.get("print_totals") or {}
    return sum(
        (
            bool(_printed_ref(r)),
            r.get("vessel_source") in ("print", "data"),
            any(ln.get("cost") for ln in r["lines"]),
            totals.get("grand") is not None,
        )
    )


def _survivor_rank(r: Record) -> tuple[Any, ...]:
    path = r["source"]["files"][0]
    return (
        r["source"]["kind"] != "data_entry",
        -_evidence(r),
        _copy_marked(r),
        bool(_markers(r)),
        "PDF/" in path,
        len(path),
        path,
    )


def _differences(keep: Record, drop: Record) -> list[str]:
    """Fields a dropped copy carries differently from its survivor."""
    out = []
    if _digits(keep["number"]["original"]) != _digits(drop["number"]["original"]):
        out.append("number")
    ref = _ref_key(drop.get("client_ref"))
    if ref and ref != _ref_key(keep.get("client_ref")):
        out.append("client_ref")
    if drop.get("vessel") and _norm(drop["vessel"]) != _norm(keep.get("vessel")):
        out.append("vessel")
    if (drop.get("terms") or {}) != (keep.get("terms") or {}):
        out.append("terms")
    out.extend(
        field
        for field in ("cost", "vendor")
        if [ln.get(field) for ln in drop["lines"]] != [ln.get(field) for ln in keep["lines"]]
    )
    return out


def _adopt(keep: Record, drop: Record) -> None:
    """Take the vessel or reference a survivor lacks from its copy."""
    if not keep.get("vessel") and drop.get("vessel"):
        for field in ("vessel", "vessel_raw", "vessel_source"):
            if field in drop:
                keep[field] = drop[field]
        keep["flags"].append("vessel_from_copy")
    if not _printed_ref(keep) and _printed_ref(drop):
        keep["client_ref"], keep["client_ref_source"] = drop["client_ref"], "print"
        keep["flags"].append("client_ref_from_copy")


def _merge(keep: Record, drop: Record, reason: str, dropped: list[Record]) -> None:
    diffs = _differences(keep, drop)
    for path in drop["source"]["files"]:
        if path not in keep["source"]["files"]:
            keep["source"]["files"].append(path)
            keep["duplicates"].append({"path": path, "reason": reason})
    keep.setdefault("aliases", []).append(
        {
            "id": drop["id"],
            "path": drop["source"]["files"][0],
            "number": drop["number"]["original"],
            "client_ref": drop.get("client_ref"),
            "vessel": drop.get("vessel"),
            "terms": drop.get("terms"),
            "differs": diffs,
        }
    )
    if "number" in diffs and "copy_number_differs" not in keep["flags"]:
        keep["flags"].append("copy_number_differs")
    if set(diffs) - {"number"} and "copy_differs" not in keep["flags"]:
        keep["flags"].append("copy_differs")
    _adopt(keep, drop)
    dropped.append({"id": drop["id"], "kept": keep["id"], "reason": reason, "differs": diffs})


def _drop_stale_sheets(records: list[Record], dropped: list[Record]) -> list[Record]:
    """Drop revision sheets that only repeat another client's quotation."""
    by_lines: dict[str, list[Record]] = defaultdict(list)
    for r in records:
        if not _sheet_marked(r):
            by_lines[_lines_fingerprint(r)].append(r)
    by_id = {r["id"]: r for r in records}
    kept: list[Record] = []
    for r in records:
        others = [
            o
            for o in by_lines.get(_lines_fingerprint(r), [])
            if _sheet_marked(r) and o["client"]["name"] != r["client"]["name"]
        ]
        if not others:
            kept.append(r)
            continue
        reason = f"stale revision sheet: same lines as {others[0]['id']}"
        owner = by_id.get(r.get("revision_of") or "")
        if owner is not None:
            owner["flags"].append(f"stale_revision_sheet:{r['source']['sheet']}")
            owner["excluded_sheets"].append(
                {
                    "sheet": r["source"]["sheet"],
                    "reason": reason,
                    "number": r["number"]["original"],
                    "client": r["client"]["name"],
                    "lines": len(r["lines"]),
                    "grand": r["computed_totals"]["grand"],
                }
            )
        dropped.append({"id": r["id"], "kept": None, "reason": reason, "differs": []})
    return kept


def _drop_identical(records: list[Record], dropped: list[Record]) -> list[Record]:
    groups: dict[str, list[Record]] = defaultdict(list)
    for r in records:
        groups[fingerprint(r)].append(r)
    kept: list[Record] = []
    for group in groups.values():
        group.sort(key=_survivor_rank)
        clusters: list[list[Record]] = []
        for r in group:
            for cluster in clusters:
                if all(same_request(r, other) for other in cluster):
                    cluster.append(r)
                    break
            else:
                clusters.append([r])
        for cluster in clusters:
            kept.append(cluster[0])
            for other in cluster[1:]:
                _merge(cluster[0], other, "identical copy", dropped)
    return kept


def _close(a: float | None, b: float | None) -> bool:
    return a is not None and b is not None and abs(a - b) <= 1


def _same_print(a: Record, b: Record) -> bool:
    """Same printed number, date and grand total."""
    return (
        _digits(a["number"]["original"]) == _digits(b["number"]["original"])
        and a["date"] == b["date"]
        and _close((a["print_totals"] or {}).get("grand"), (b["print_totals"] or {}).get("grand"))
    )


def _drop_print_exports(records: list[Record], dropped: list[Record]) -> list[Record]:
    """Merge print-only exports into the workbook (or export) they print.

    Workbooks come first in the survivor order, so an export joins the
    workbook it matches, else the first export of the same print.
    """
    kept: list[Record] = []
    for r in sorted(records, key=_survivor_rank):
        if r["source"]["kind"] == "print_only":
            match = next((k for k in kept if _same_print(k, r)), None)
            if match is not None:
                _merge(match, r, "print export of the same quotation", dropped)
                continue
        kept.append(r)
    return kept


# Revisions


def _number_groups(records: list[Record]) -> list[list[Record]]:
    parent = list(range(len(records)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    owner: dict[str, int] = {}
    for i, r in enumerate(records):
        numbers = [r["number"]["original"]]
        if "file_name_describes_other_quotation" not in r["flags"]:
            numbers.append(r["file_name"].get("number"))
        for number in numbers:
            digits = _digits(number)
            if digits is None:
                continue
            key = f"{_year(r)}:{digits}"
            if key in owner:
                parent[find(i)] = find(owner[key])
            else:
                owner[key] = i
    groups: dict[int, list[Record]] = defaultdict(list)
    for i, r in enumerate(records):
        groups[find(i)].append(r)
    return list(groups.values())


def _related(a: Record, b: Record) -> bool:
    """Same client, same request (or unknown), and related lines.

    A file name marked as a revision needs one line in common, allowing
    small edits; a copy marker such as "(1)" or a shared printed
    reference needs a fifth of the lines; anything else needs half the
    lines, or most of the smaller record's lines kept in the larger.
    """
    if a["client"]["name"] != b["client"]["name"] or not same_request(a, b):
        return False
    sim = similarity(a, b)
    if _revision_marked(a) or _revision_marked(b):
        return sim > 0 or _common_line(a, b)
    same_ref = bool(_printed_ref(a)) and _printed_ref(a) == _printed_ref(b)
    if sim >= 0.2 and (_copy_marked(a) or _copy_marked(b) or same_ref):
        return True
    return sim >= 0.5 or _grown(a, b)


def _chains(group: list[Record], kept_as: dict[str, str]) -> list[list[Record]]:
    """Split a number group into chains, whatever order the records come in.

    A record joins every chain it is related to, and a revision sheet
    joins the DATA record its workbook bound it to.
    """
    index = {r["id"]: i for i, r in enumerate(group)}
    parent = list(range(len(group)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i, r in enumerate(group):
        bound = r.get("revision_of")
        bound = kept_as.get(bound, bound) if bound else None
        if bound in index:
            parent[find(i)] = find(index[bound])
        for j in range(i):
            if find(i) != find(j) and _related(r, group[j]):
                parent[find(i)] = find(j)
    chains: dict[int, list[Record]] = defaultdict(list)
    for i, r in enumerate(group):
        chains[find(i)].append(r)
    return list(chains.values())


def _chain_order(r: Record) -> tuple[Any, ...]:
    """By date; on a tie the unmarked workbook comes before exports and revisions.

    Records still tied are ordered by when their workbook was last saved
    (the time stored inside it), then by path.
    """
    return (
        r["date"] or "9999",
        bool(_markers(r)),
        r["source"]["kind"] == "print_only",
        r["source"].get("modified") or "",
        r["source"]["files"][0],
    )


def _relate(a: Record, b: Record, relation: str) -> None:
    a["related_to"].append({"id": b["id"], "relation": relation})
    b["related_to"].append({"id": a["id"], "relation": relation})


def _link_revisions(records: list[Record], kept_as: dict[str, str]) -> None:
    for group in _number_groups(records):
        if len(group) < 2:
            continue
        chains = _chains(group, kept_as)
        for chain in chains:
            chain.sort(key=_chain_order)
        if len(chains) > 1:
            for r in group:
                r["flags"].append("shared_number")
        for i, chain in enumerate(chains):
            for other in chains[:i]:
                a, b = chain[0], other[0]
                if a["client"]["name"] == b["client"]["name"] and _any_refs(a) & _any_refs(b):
                    # One request answered twice with different lines.
                    _relate(a, b, "same_request_other_lines")
                    for r in (a, b):
                        if "same_request_other_lines" not in r["flags"]:
                            r["flags"].append("same_request_other_lines")
        per_key: dict[str, int] = defaultdict(int)
        for chain in chains:
            if len(chain) < 2:
                continue
            base = chain[0]
            digits = _digits(base["number"]["original"]) or _digits(base["file_name"].get("number"))
            stem = f"{_year(base)}:{digits}:{base['client']['name']}"
            per_key[stem] += 1
            key = f"{stem}:{per_key[stem]}"
            crosses = len({_digits(r["number"]["original"]) for r in chain}) > 1
            for i, r in enumerate(chain):
                r["revision"] = {
                    "group": key,
                    "index": i,
                    "count": len(chain),
                    "base_id": base["id"],
                }
                if crosses:
                    r["flags"].append("revision_chain_crosses_numbers")
                if any(_order_undetermined(r, o) for o in chain if o is not r):
                    r["flags"].append("revision_order_undetermined")


def _order_undetermined(a: Record, b: Record) -> bool:
    """Same date and no marker sets one apart: only the path orders them."""
    return a["date"] == b["date"] and sorted(_markers(a)) == sorted(_markers(b))


def _relate_across_numbers(records: list[Record]) -> None:
    """Link a revision filed under a new number to the quotation it revises.

    A "Revision" under a new number answers an earlier request a few days
    later. The client may order against the new number, so the two are not chained;
    the owner decides.
    """
    for r in records:
        if not _revision_marked(r) or (r["revision"] and r["revision"]["index"] > 0):
            continue
        refs = _any_refs(r)
        for o in records:
            if (
                o is r
                or o["client"]["name"] != r["client"]["name"]
                or _digits(o["number"]["original"]) == _digits(r["number"]["original"])
                or (o["date"] or "9999") > (r["date"] or "")
                or not refs & _any_refs(o)
                or not _common_line(r, o)
            ):
                continue
            _relate(r, o, "revision_under_other_number")
            if "revision_of_other_number" not in r["flags"]:
                r["flags"].append("revision_of_other_number")


def _flag_same_lines(records: list[Record]) -> None:
    by_lines: dict[str, list[Record]] = defaultdict(list)
    for r in records:
        by_lines[_lines_fingerprint(r)].append(r)
    for group in by_lines.values():
        if len(group) < 2:
            continue
        clients = {r["client"]["name"] for r in group}
        flag = "same_lines_as_other_client" if len(clients) > 1 else "same_lines_as_other_request"
        for r in group:
            r["flags"].append(flag)
            r["same_lines_as"] = [o["id"] for o in group if o is not r]


def resolve_duplicates(records: list[Record]) -> tuple[list[Record], list[Record]]:
    """Return (kept records, dropped copies) with revision links set."""
    dropped: list[Record] = []
    for r in records:
        r.setdefault("related_to", [])
        r.setdefault("aliases", [])
        r.setdefault("excluded_sheets", [])
    _mark_refs(records)
    kept = _drop_stale_sheets(records, dropped)
    kept = _drop_identical(kept, dropped)
    kept = _drop_print_exports(kept, dropped)
    kept_as = {d["id"]: d["kept"] for d in dropped if d["kept"]}
    _link_revisions(kept, kept_as)
    _relate_across_numbers(kept)
    _flag_same_lines(kept)
    kept.sort(key=lambda r: (r["date"] or "9999", r["id"]))
    return kept, dropped
