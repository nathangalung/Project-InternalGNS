"""Parse every quotation workbook under Data/Data/Quotation.

Writes out/staged.json (one record per quotation, with its evidence) and
out/parse_report.md (counts, exclusions, files that could not be parsed,
duplicates, revisions and the totals reconciliation).

Inputs: GNS_DATA_DIR (default <repo>/Data/Data) and, for the
reconciliation, GNS_ORACLE_DIR (default ~/.cache/gns-reimport) with the
survey's pdf.tsv and disc.json. Nothing under either is modified.
"""

from __future__ import annotations

import json
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from dedup import resolve_duplicates
from issued import apply_issued_pdfs
from paths import OUT_DIR, data_dir
from quotation import build_workbook, vessel_from_text
from reconcile import (
    attach_pdfs,
    classify_unmatched,
    compare_print_oracle,
    compare_totals,
    content_in_pdf,
    fill_pdf_totals,
    load_pdf_index,
    pdf_grand_differs,
    pdf_text,
)
from scan import discover, name_exclusion

Record = dict[str, Any]


def oracle_dir() -> Path:
    return Path(os.environ.get("GNS_ORACLE_DIR", Path.home() / ".cache" / "gns-reimport"))


# Vessel names


def _vessel_key(name: str) -> str:
    s = re.sub(r"\s+", " ", name.upper()).strip()
    return re.sub(r"^(MV|M/V|TB|TUG ?BOAT|BG|FC|KM)\.? ", "", s)


def resolve_vessels(records: list[Record]) -> None:
    """Name each vessel the same way across records.

    A bare name ("Marina 18") counts when it matches a vessel seen with a
    prefix elsewhere, and every vessel takes its most common prefixed
    spelling ("MV YUXIN SATU"); the text as found stays in vessel_raw.
    """
    forms: dict[str, Counter[str]] = defaultdict(Counter)
    for r in records:
        if r["vessel"]:
            forms[_vessel_key(r["vessel"])][re.sub(r"\s+", " ", r["vessel"].upper()).strip()] += 1
    canon = {
        key: max([f for f in c if f != key] or list(c), key=lambda f, c=c: (c[f], f))
        for key, c in forms.items()
    }
    for r in records:
        if r["vessel"] is None:
            for text in r["vessel_candidates"]:
                if _vessel_key(text) in canon:
                    r["vessel"] = text
                    r["vessel_source"] = "file" if text in r["file_name"]["parts"] else "print"
                    break
        r["vessel_raw"] = r["vessel"]
        vessel_key = _vessel_key(r["vessel"]) if r["vessel"] else None
        if vessel_key:
            r["vessel"] = canon[vessel_key]
        parts = (
            []
            if "file_name_describes_other_quotation" in r.get("flags", [])
            else r["file_name"]["parts"]
        )
        r["topic"] = (
            " - ".join(
                p for p in parts if _vessel_key(p) != vessel_key and vessel_from_text(p) is None
            )
            or None
        )
        del r["vessel_candidates"]


# Run


def parse_all(root: Path) -> tuple[list[Record], list[Record]]:
    """Build records for every workbook; return (records, excluded files)."""
    records: list[Record] = []
    excluded: list[Record] = []
    files = discover(root)
    for i, path in enumerate(files, start=1):
        rel = path.relative_to(root).as_posix()
        reason = name_exclusion(path.name)
        if reason is None:
            built, reason = build_workbook(path, root)
            records.extend(built)
        if reason is not None:
            excluded.append({"path": rel, "reason": reason})
        if i % 100 == 0:
            print(f"  {i}/{len(files)} files", file=sys.stderr)
    resolve_vessels(records)
    return records, excluded


def check_pdf_content(kept: list[Record], root: Path) -> int:
    """Read the PDF of every record whose total differs from it.

    A record none of whose lines the PDF prints holds another
    quotation's content (the Q-639 workbook): it is flagged for the
    owner, and its PDF is the only copy of what the client received.
    Returns how many PDFs were read.
    """
    checked = 0
    for r in kept:
        if not pdf_grand_differs(r):
            continue
        text = pdf_text(root / r["pdf"]["path"])
        if not text:
            continue
        checked += 1
        r["pdf_content"] = content_in_pdf(r, text)
        if not r["pdf_content"]:
            r["flags"].append("workbook_holds_other_content")
    return checked


def reconcile(kept: list[Record], oracles: Path, root: Path) -> Record:
    """Attach PDFs and compare totals; return the reconciliation summary."""
    summary: Record = {"oracle_dir": str(oracles), "pdf_index": False, "print_oracle": False}
    pdf_tsv, disc_json = oracles / "pdf.tsv", oracles / "disc.json"
    if pdf_tsv.exists():
        pdfs = [p for p in load_pdf_index(pdf_tsv) if p["path"].startswith("Quotation")]
        summary["pdf_index"] = True
        summary["pdfs"] = len(pdfs)
        summary["pdf_totals_read"] = fill_pdf_totals(pdfs, root)
        summary["pdf_totals_missing"] = [p["path"] for p in pdfs if p["grand"] is None]
        summary["unmatched_pdfs"] = attach_pdfs(kept, pdfs)
        classify_unmatched(summary["unmatched_pdfs"], kept)
        summary["pdf_content_checked"] = check_pdf_content(kept, root)
    for r in kept:
        r["reconciliation"] = compare_totals(r)
    if disc_json.exists():
        entries = {e["path"]: e for e in json.loads(disc_json.read_text(encoding="utf-8"))}
        summary["print_oracle"] = True
        diffs = []
        compared = 0
        for r in kept:
            for path in r["source"]["files"]:
                entry = entries.get(path)
                if entry is None or r["source"]["sheet"] not in ("DATA ENTRI", "DATA ENTRY"):
                    continue
                compared += 1
                diffs.extend(
                    {"path": path, **d} for d in compare_print_oracle(r["print_totals"], entry)
                )
                break
        summary["print_oracle_compared"] = compared
        summary["print_oracle_diffs"] = diffs
    return summary


def run(data: Path, oracles: Path) -> tuple[Record, str]:
    root = data / "Quotation"
    records, excluded = parse_all(root)
    kept, dropped = resolve_duplicates(records)
    summary = reconcile(kept, oracles, root)
    unread = apply_issued_pdfs(kept, summary.get("unmatched_pdfs", []), root)
    staged = {
        "source_root": "Data/Data/Quotation",
        "quotations": kept,
        "excluded_files": excluded,
        "dropped_copies": dropped,
        "unmatched_pdfs": summary.get("unmatched_pdfs", []),
        "issued_pdfs_unread": unread,
    }
    return staged, render_report(staged, records, summary, root)


# Report


def _md_escape(s: object) -> str:
    return str(s).replace("|", "\\|").replace("\n", " ")


def _rp(v: float | None) -> str:
    return "-" if v is None else f"{v:,.2f}"


def render_report(staged: Record, built: list[Record], summary: Record, root: Path) -> str:
    kept: list[Record] = staged["quotations"]
    excluded: list[Record] = staged["excluded_files"]
    dropped: list[Record] = staged["dropped_copies"]
    files = discover(root)
    by_reason = Counter(e["reason"] for e in excluded)
    unparsed = [e for e in excluded if e["reason"] not in ("lock file",)]
    lines = sum(len(r["lines"]) for r in kept)
    out: list[str] = ["# Quotation parse report", ""]
    out += [
        "Generated by `apps/api/db/import/parse.py` from `Data/Data/Quotation`.",
        "",
        "## Summary",
        "",
        "| Item | Count |",
        "|---|---|",
        f"| .xlsx files found (recursive) | {len(files)} |",
        f"| Files excluded (see below) | {len(excluded)} |",
        f"| Workbooks parsed | {len(files) - len(excluded)} |",
        f"| Quotation records built | {len(built)} |",
        f"| Records dropped (identical copy, print export, stale sheet) | {len(dropped)} |",
        f"| Quotations in staged.json | {len(kept)} |",
        f"| Lines in staged.json | {lines} |",
        f"| Revision chains | {len({r['revision']['group'] for r in kept if r['revision']})} |",
        f"| Sheets not imported (see below) | {len(_excluded_sheets(kept))} |",
        "",
        "Every file is accounted for: parsed into a record, merged into another",
        "record as a copy, or excluded with the reason below. Every sheet left out",
        "of a parsed workbook is listed under Sheets not imported.",
        "",
    ]

    per_year: dict[object, Counter[str]] = defaultdict(Counter)
    for r in built:
        per_year[r["year"]]["built"] += 1
    for r in kept:
        c = per_year[r["year"]]
        c["kept"] += 1
        c["lines"] += len(r["lines"])
        c["unpriced"] += "unpriced" in r["flags"]
        c["revisions"] += bool(r["revision"] and r["revision"]["index"] > 0)
        c["print_only"] += r["source"]["kind"] == "print_only"
    for d in dropped:
        year = next((r["year"] for r in built if r["id"] == d["id"]), None)
        per_year[year]["dropped"] += 1
    out += [
        "## Counts per year",
        "",
        "| Year | Records built | Copies dropped | Quotations | Revisions (Rev.n) "
        "| Print-only source | Unpriced | Lines |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for year in sorted(per_year, key=str):
        c = per_year[year]
        out.append(
            f"| {year} | {c['built']} | {c['dropped']} | {c['kept']} | {c['revisions']} "
            f"| {c['print_only']} | {c['unpriced']} | {c['lines']} |"
        )
    out += ["", "## Exclusions per reason", "", "| Reason | Files |", "|---|---|"]
    out += [f"| {_md_escape(k)} | {v} |" for k, v in by_reason.most_common()]
    out += ["", "## Files not parsed into a quotation", ""]
    out += ["Lock files (`~$…`) are Excel's open-file markers and hold no data.", ""]
    out += ["| File | Reason |", "|---|---|"]
    out += [f"| {_md_escape(e['path'])} | {_md_escape(e['reason'])} |" for e in unparsed]

    out += ["", "## Sheets not imported", ""]
    out += ["| Workbook | Sheet | Printed number | Client | Lines | Grand total | Reason |"]
    out += ["|---|---|---|---|---|---|---|"]
    out += [
        f"| {_md_escape(path)} | {_md_escape(s['sheet'])} | {_md_escape(s['number'])} "
        f"| {_md_escape(s['client'])} | {s['lines']} | {_rp(s['grand'])} "
        f"| {_md_escape(s['reason'])} |"
        for path, s in _excluded_sheets(kept)
    ]

    out += ["", "## Records dropped", ""]
    out += ["A dropped copy stays on the kept record under `aliases`, with the fields"]
    out += ["it carried differently (`differs`).", ""]
    out += ["| Dropped | Kept | Reason | Differs |", "|---|---|---|---|"]
    out += [
        f"| {_md_escape(d['id'])} | {_md_escape(d['kept'] or '-')} | {_md_escape(d['reason'])} "
        f"| {', '.join(d['differs']) or '-'} |"
        for d in dropped
    ]

    chains: dict[str, list[Record]] = defaultdict(list)
    for r in kept:
        if r["revision"]:
            chains[r["revision"]["group"]].append(r)
    out += ["", "## Revision chains", "", "| Group | Rev | Date | Source | Grand total |"]
    out += ["|---|---|---|---|---|"]
    for key in sorted(chains):
        for r in sorted(chains[key], key=lambda x: x["revision"]["index"]):
            rev = r["revision"]["index"]
            out.append(
                f"| {_md_escape(key)} | {'base' if rev == 0 else f'Rev.{rev}'} | {r['date']} "
                f"| {_md_escape(r['source']['files'][0])} | {_rp(r['computed_totals']['grand'])} |"
            )

    shared = [r for r in kept if "shared_number" in r["flags"]]
    out += ["", "## Different quotations sharing a number (kept separate)", ""]
    out += ["| Number | Client | Date | Source |", "|---|---|---|---|"]
    for r in sorted(shared, key=lambda x: (x["number"]["original"] or "", x["id"])):
        out.append(
            f"| {_md_escape(r['number']['original'])} | {_md_escape(r['client']['name'])} "
            f"| {r['date']} | {_md_escape(r['source']['files'][0])} |"
        )

    qflags = Counter(f.split(":")[0] for r in kept for f in r["flags"])
    lflags = Counter(f for r in kept for ln in r["lines"] for f in ln["flags"])
    out += ["", "## Flags", "", "| Quotation flag | Quotations |", "|---|---|"]
    out += [f"| {k} | {v} |" for k, v in sorted(qflags.items())]
    out += ["", "| Line flag | Lines |", "|---|---|"]
    out += [f"| {k} | {v} |" for k, v in sorted(lflags.items())]
    unknown = [r for r in kept if r["client"]["name"] is None]
    if unknown:
        out += ["", "Quotations whose client could not be resolved:", ""]
        out += [f"- {_md_escape(r['id'])} ({_md_escape(r['client']['raw'])})" for r in unknown]
    out += _report_owner_decisions(kept)
    out += _report_issued(kept, staged.get("issued_pdfs_unread", []))
    out += _report_reconciliation(kept, summary)
    return "\n".join(out) + "\n"


_ISSUED = {
    "header_from_pdf": "header (number, date, reference, contact) from the PDF",
    "lines_from_pdf": "lines, discount and header from the PDF",
    "pdf_only_version": "issued version known only as a PDF, chained by date",
    "pdf_lines_unread": "PDF differs but its table could not be read; total noted",
}


def _report_issued(kept: list[Record], unread: list[Record]) -> list[str]:
    """What the issued PDFs changed, and the PDFs that could not be used."""
    out = ["", "## Issued PDFs", "", "| Quotation | Date | Change |", "|---|---|---|"]
    for r in sorted(kept, key=lambda x: (x["number"]["original"] or "", x["id"])):
        for flag, text in _ISSUED.items():
            if flag in r["flags"]:
                out.append(f"| {_md_escape(r['number']['original'])} | {r['date']} | {text} |")
    out += ["", "PDFs not used (table unreadable, or no quotation to attach to):", ""]
    out += [f"- {_md_escape(u['path'])} ({u['number']}; {u['why']})" for u in unread]
    return out


def _excluded_sheets(kept: list[Record]) -> list[tuple[str, Record]]:
    """Each sheet left out of a workbook, once per workbook."""
    seen: set[tuple[str, str]] = set()
    out = []
    for r in kept:
        path = r["source"]["files"][0]
        for s in r.get("excluded_sheets", []):
            if (path, s["sheet"]) not in seen:
                seen.add((path, s["sheet"]))
                out.append((path, s))
    return out


def _quote_row(r: Record, *extra: object) -> str:
    cells = [
        r["number"]["original"],
        r["client"]["name"],
        r["date"],
        r["source"]["files"][0],
        *extra,
    ]
    return "| " + " | ".join(_md_escape("-" if c is None else c) for c in cells) + " |"


def _flagged(kept: list[Record], flag: str) -> list[Record]:
    return [r for r in kept if any(f.split(":")[0] == flag for f in r["flags"])]


def _report_owner_decisions(kept: list[Record]) -> list[str]:
    """Judgements the parser leaves to the owner, one table each."""
    head = "| Number | Client | Date | Source |"
    out = ["", "## Owner decisions", ""]
    out += ["The parser keeps every record below and flags it; none is resolved by guessing.", ""]

    left_out = [(r, ln) for r in kept for ln in r["lines"] if not ln["in_total"] and ln["sell"]]
    out += ["### Priced lines kept out of the totals (`in_total: false`)", ""]
    out += [
        "The PRINT sheet did not total them: options, kit components, lines PRINT lacks",
        "or prints without an amount. The app has no optional line, so plan step 5 must",
        "drop them, import them as separate lines, or import them at zero.",
        "",
        f"{head} Row | Request | Unit price | Why |",
        "|---|---|---|---|---|---|---|---|",
    ]
    out += [
        _quote_row(
            r,
            ln["row"],
            (ln["request"] or "")[:60],
            _rp(ln["sell"]),
            ", ".join(
                f
                for f in ln["flags"]
                if f
                in (
                    "not_on_print",
                    "no_amount_on_print",
                    "kit_component_not_totalled",
                    "not_in_amount_column",
                )
            ),
        )
        for r, ln in left_out
    ]

    sections = [
        (
            "Price lists and options whose PRINT total is Rp 0",
            "print_price_list",
            "Every priced line is kept in the computed total; the client may have ordered "
            "one option only.",
        ),
        (
            "PRINT totals of Rp 0 beside priced lines",
            "print_total_zero",
            "The amount formulas were empty when printed; the lines are kept.",
        ),
        (
            "Same-date revisions with no marker to order them",
            "revision_order_undetermined",
            "Only the file path decides which record is the base; the owner picks.",
        ),
        (
            "Revision chains whose records print different numbers",
            "revision_chain_crosses_numbers",
            "",
        ),
        (
            "Revisions filed under a new number",
            "revision_of_other_number",
            "Linked by `related_to` (same client, reference and lines), not chained: the "
            "client may have ordered against the new number.",
        ),
        (
            "One request answered by records with no line in common",
            "same_request_other_lines",
            "Kept as separate quotations and linked by `related_to` (a request "
            "answered twice, or a workbook reused for another offer).",
        ),
        (
            "Copies dropped although they print another number",
            "copy_number_differs",
            "The dropped number stays under `aliases`; clients may quote it on a PO.",
        ),
        (
            "Copies dropped with a different reference, vessel, terms, cost or vendor",
            "copy_differs",
            "The survivor is the copy with the most evidence; the other values are under "
            "`aliases`.",
        ),
        (
            "PDFs printing another number than the workbook",
            "pdf_number_ne_print",
            "The PDF is what the client received.",
        ),
        (
            "Workbooks holding another quotation than their PDF",
            "workbook_holds_other_content",
            "None of the record's lines is on its PDF: exclude the record or rebuild it "
            "from the PDF.",
        ),
        (
            "References in a format another client uses",
            "client_ref_foreign_format",
            "Left over from a copied workbook (Pelita's V-26 references on Ocean Maritim "
            "and Karunia Aman Sentosa); kept as printed, ignored for matching.",
        ),
        (
            "Printed references the file name contradicts",
            "client_ref_conflicts_file_name",
            "Kept as printed, ignored for matching.",
        ),
        (
            "File names describing another quotation",
            "file_name_describes_other_quotation",
            "The name's number and client differ from the sheet's, so its vessel, "
            "reference and topic are not used.",
        ),
        (
            "Dates in another year than their folder",
            "date_year_ne_folder",
            "The number and year come from the date (a 2026-folder file dated 2025 that "
            "prints a 2026 number).",
        ),
    ]
    for title, flag, note in sections:
        found = _flagged(kept, flag)
        out += ["", f"### {title} (`{flag}`, {len(found)})", ""]
        if note:
            out += [note, ""]
        if not found:
            continue
        out += [f"{head} Detail |", "|---|---|---|---|---|"]
        out += [_quote_row(r, _decision_detail(r, flag)) for r in found]
    return out


def _decision_detail(r: Record, flag: str) -> str:
    if flag in ("revision_order_undetermined", "revision_chain_crosses_numbers"):
        rev = r["revision"]
        return f"{rev['group']} index {rev['index']}"
    if flag in ("revision_of_other_number", "same_request_other_lines"):
        return "; ".join(x["id"] for x in r["related_to"])
    if flag in ("copy_number_differs", "copy_differs"):
        return "; ".join(
            f"{a['number']} ({', '.join(a['differs'])}) {a['path']}"
            for a in r["aliases"]
            if a["differs"]
        )
    if flag == "pdf_number_ne_print":
        return f"PDF {r['number']['pdf']}: {r['pdf']['path']}"
    if flag == "workbook_holds_other_content":
        return f"PDF {r['pdf']['path']} ({_rp(r['pdf']['grand'])})"
    if flag.startswith("client_ref"):
        return f"{r['client_ref']} (file: {', '.join(r['file_name']['refs']) or '-'})"
    if flag == "file_name_describes_other_quotation":
        return f"file {r['number']['file']} for {r['file_name']['client_hint']}"
    if flag == "date_year_ne_folder":
        return f"printed {r['number']['print']}"
    return ""


def _report_reconciliation(kept: list[Record], summary: Record) -> list[str]:
    out = ["", "## Totals reconciliation", ""]
    with_print = [
        r for r in kept if r["print_totals"] and r["print_totals"].get("grand") is not None
    ]
    with_pdf = [r for r in kept if r.get("pdf")]
    mism = [(r, m) for r in kept for m in r.get("reconciliation", [])]
    bad = {id(r) for r, _ in mism}
    print_ok = sum(
        1 for r in with_print if not any(m["source"] == "print" for m in r["reconciliation"])
    )
    pdf_ok = sum(1 for r in with_pdf if not any(m["source"] == "pdf" for m in r["reconciliation"]))
    out += [
        "Computed totals (lines, discount, DPP, PPN, charges) against the PRINT totals",
        "block of the same workbook and the grand total printed on the archived PDF,",
        "with a tolerance of Rp 1.",
        "",
        "| Check | Count |",
        "|---|---|",
        f"| Quotations with a PRINT grand total | {len(with_print)} |",
        f"| ... all PRINT fields within Rp 1 | {print_ok} |",
        f"| Quotations matched to a PDF | {len(with_pdf)} |",
        f"| ... PDF grand total within Rp 1 (or equal to PRINT) | {pdf_ok} |",
        f"| Quotations with any mismatch | {len(bad)} |",
        "",
    ]
    causes = Counter((m["source"], m["cause"]) for _, m in mism)
    quotes_by_cause: dict[str, set[int]] = defaultdict(set)
    for r, m in mism:
        quotes_by_cause[m["cause"]].add(id(r))
    out += ["| Source | Cause | Field mismatches | Quotations |", "|---|---|---|---|"]
    out += [
        f"| {s} | {c} | {n} | {len(quotes_by_cause[c])} |" for (s, c), n in causes.most_common()
    ]
    out += ["", "Causes:", ""]
    out += [f"- `{k}`: {v}" for k, v in CAUSES.items()]
    out += ["", "### Every mismatch above Rp 1", ""]
    out += ["| Quotation | Field | Against | Computed | Printed | Diff | Cause |"]
    out += ["|---|---|---|---|---|---|---|"]
    for r, m in sorted(mism, key=lambda x: (x[0]["id"], x[1]["source"], x[1]["field"])):
        out.append(
            f"| {_md_escape(r['id'])} | {m['field']} | {m['source']} | {_rp(m['computed'])} "
            f"| {_rp(m['other'])} | {_rp(m['diff'])} | {m['cause']} |"
        )
    if summary.get("pdf_index"):
        unmatched = summary.get("unmatched_pdfs", [])
        out += ["", "### PDFs not attached to a record", ""]
        out += ["| PDF | Printed number | Date | Grand total | Status |", "|---|---|---|---|---|"]
        out += [
            f"| {_md_escape(p['path'])} | {p['number']} | {p['date']} | {_rp(p['grand'])} "
            f"| {_md_escape(p.get('status', '-'))} |"
            for p in unmatched
        ]
        other = _flagged(kept, "workbook_holds_other_content")
        out += ["", "### PDFs whose content has no workbook", ""]
        out += [
            f"Attached by number, but their workbook holds another quotation; "
            f"{summary.get('pdf_content_checked', 0)} PDFs whose total differs were read.",
            "",
            "| PDF | Printed number | Date | Grand total | Workbook |",
            "|---|---|---|---|---|",
        ]
        out += [
            f"| {_md_escape(r['pdf']['path'])} | {r['pdf']['number']} | {r['pdf']['date']} "
            f"| {_rp(r['pdf']['grand'])} | {_md_escape(r['source']['files'][0])} |"
            for r in other
        ]
    else:
        out += ["", f"pdf.tsv not found under {summary['oracle_dir']}; PDF check skipped."]
    if summary.get("print_oracle"):
        diffs = summary["print_oracle_diffs"]
        out += [
            "",
            "### PRINT reader against the survey's totals blocks (disc.json)",
            "",
            f"{summary['print_oracle_compared']} workbooks compared on discount, DPP, PPN and",
            f"grand total; {len({d['path'] for d in diffs})} differ. The survey read the last",
            "number in each labelled row, so it misses values one column further right and",
            "takes page subtotals for totals; each difference below was checked against the",
            "sheet.",
            "",
            "| Workbook | Field | Ours | Survey | Survey label |",
            "|---|---|---|---|---|",
        ]
        out += [
            f"| {_md_escape(d['path'])} | {d['field']} | {_rp(d['ours'])} | {_rp(d['oracle'])} "
            f"| {_md_escape(d['label'])} |"
            for d in diffs
        ]
    return out


CAUSES = {
    "print_total_zero_price_list": "price list or options: PRINT shows unit prices but no "
    "amounts, so its totals are Rp 0; the lines are kept and the owner decides how to "
    "import them (the app has no optional line).",
    "print_totals_zero": "the PRINT totals block is all zero (amount formulas empty when "
    "printed); the PDF, where one exists, shows the same.",
    "print_grand_is_dpp_plus_ppn": "the 2026 PRINT template adds PPN to DPP Nilai Lain "
    "instead of to the Sub Total, so its Grand Total is short by Sub Total - DPP.",
    "print_ppn_on_pre_discount_amount": "the PRINT block shows a discount but computes PPN "
    "and the total on the amount before it.",
    "print_line_amounts_differ": "PRINT shows different amounts than DATA ENTRI on the "
    "lines listed in the record's print_line_diffs, and those lines account for the whole "
    "difference (a PRINT cell typed over or pointing at another row).",
    "line_amounts_differ": "the PRINT amounts or line set differ from DATA ENTRI and no "
    "single set of lines explains it (PRINT formulas pointing at the wrong rows).",
    "print_field_zero": "PRINT shows zero for this field while the others are filled.",
    "pdf_total_zero": "the PDF prints its Grand Total as Rp - (amounts blank when printed).",
    "follows_gross_difference": "follows from the gross difference on the same quotation.",
    "discount_differs": "the printed discount differs from the computed one.",
    "dpp_rule_differs": "the PRINT block and the computed totals disagree on DPP Nilai Lain.",
    "workbook_holds_other_content": "the PDF prints none of the record's lines: the "
    "workbook was reused for another quotation, so the PDF is the only copy of what the "
    "client received under this number (flagged for the owner).",
    "workbook_changed_after_pdf": "the workbook's PRINT total differs from the PDF the "
    "client received; the workbook was edited after the PDF was made.",
    "pdf_differs_no_print_total": "the PDF differs and the workbook has no PRINT total.",
    "unexplained": "no known cause; listed for review.",
}


def dump_staged(staged: Record) -> str:
    """JSON with one list item (a quotation) per line, so diffs stay readable."""

    def enc(v: object) -> str:
        return json.dumps(v, ensure_ascii=False, default=str)

    parts = []
    for key, value in staged.items():
        if isinstance(value, list):
            items = ",\n".join(enc(v) for v in value)
            parts.append(f"{enc(key)}: [\n{items}\n]")
        else:
            parts.append(f"{enc(key)}: {enc(value)}")
    return "{\n" + ",\n".join(parts) + "\n}\n"


def main() -> int:
    data = data_dir()
    if not (data / "Quotation").is_dir():
        print(f"no Quotation folder under {data}; set GNS_DATA_DIR", file=sys.stderr)
        return 1
    staged, report = run(data, oracle_dir())
    OUT_DIR.mkdir(exist_ok=True)
    (OUT_DIR / "staged.json").write_text(dump_staged(staged), encoding="utf-8")
    (OUT_DIR / "parse_report.md").write_text(report, encoding="utf-8")
    print(
        f"{len(staged['quotations'])} quotations, {len(staged['excluded_files'])} files excluded, "
        f"{len(staged['dropped_copies'])} copies dropped; wrote {OUT_DIR}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
