"""Bring the staged quotations in line with the PDFs the clients received.

Three cases, each decided by the PDF itself:

- a workbook whose header was copied from another quotation after its
  PDF was issued: the file name and the PDF print one number and the
  workbook another, so the PDF's number, date, reference and contact win;
- a workbook edited after its PDF: when the PDF's table can be read (its
  amounts add up to its printed total), its lines, discount, number and
  date replace the workbook's, keeping harga beli and vendor from the
  workbook line each PDF row matches; otherwise the record keeps the
  workbook and is flagged so the seed notes the printed total;
- an issued version that exists only as a PDF: read the same way, it
  joins its quotation's revision chain by date.

Every PDF that could not be read is returned for the report.
"""

from __future__ import annotations

import copy
import re
import shutil
import subprocess
from datetime import date
from pathlib import Path
from typing import Any

from pdf_quote import PdfLine, PdfQuote, parse_pdf_quote, trusted
from quotation import compute_totals
from reconcile import pdf_text

Record = dict[str, Any]


def _digits(number: str | None) -> str | None:
    m = re.match(r"\s*Q-?(\d+)", number or "")
    return m.group(1) if m else None


def _words(s: str | None) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", (s or "").lower()))


def pdf_created(path: Path) -> str:
    """The PDF's creation time (pdfinfo), for ordering versions of one day."""
    if shutil.which("pdfinfo") is None or not path.exists():
        return ""
    out = subprocess.run(
        ["pdfinfo", "-isodates", str(path)], capture_output=True, text=True, check=False
    ).stdout
    m = re.search(r"^CreationDate:\s*(\S+)", out, re.MULTILINE)
    return m.group(1) if m else ""


def _new_line(pl: PdfLine) -> Record:
    """A record line for a PDF row no workbook line matches."""
    return {
        "row": None,
        "no_raw": str(pl.no),
        "qty": pl.qty,
        "qty_raw": pl.qty,
        "unit_raw": pl.unit,
        "unit": pl.unit,
        "unit_mapped": pl.unit is not None,
        "request": pl.request,
        "offer": pl.offer if pl.available else None,
        "offer_note": None,
        "available": pl.available,
        "impa": None,
        "impa_raw": None,
        "impa_problem": None,
        "impa_in_text": [],
        "sell": pl.price,
        "sell_printed": pl.price,
        "cost": None,
        "line_total": pl.amount,
        "in_total": True,
        "nama_asli": None,
        "vendor": None,
        "channel": None,
        "flags": ["line_from_pdf"],
    }


def _match(pl: PdfLine, pool: list[Record]) -> Record | None:
    """The workbook line a PDF row prints: most words in common, then same price."""
    words = _words(pl.request) | _words(pl.offer)
    best, score = None, 0.0
    for ln in pool:
        theirs = _words(ln["request"]) | _words(ln["offer"])
        if not words or not theirs:
            continue
        overlap = len(words & theirs) / min(len(words), len(theirs))
        same_price = ln["sell"] is not None and abs((ln["sell"] or 0) - pl.price) <= 1
        s = overlap + (0.5 if same_price else 0.0)
        if overlap >= 0.6 and s > score:
            best, score = ln, s
    return best


def pdf_lines(q: PdfQuote, workbook: list[Record]) -> list[Record]:
    """The PDF's rows as record lines, each keeping its workbook line's details."""
    pool = list(workbook)
    out: list[Record] = []
    for pl in q.lines:
        ln = _match(pl, pool)
        if ln is None:
            out.append(_new_line(pl))
            continue
        pool.remove(ln)
        line = copy.deepcopy(ln)
        line.update(
            {
                "qty": pl.qty,
                "unit": pl.unit or line["unit"],
                "sell": pl.price,
                "sell_printed": pl.price,
                "line_total": pl.amount,
                "in_total": True,
                "available": pl.available,
            }
        )
        if not pl.available:
            line["offer"], line["cost"], line["vendor"] = None, None, None
        line["flags"] = [*line["flags"], "line_from_pdf"]
        out.append(line)
    for i, ln in enumerate(out, start=1):
        ln["line_no"] = i
    return out


def _discount(q: PdfQuote) -> Record:
    total = q.items_total or 0
    amount = q.discount
    if not amount:
        return {"kind": "none", "pct": None, "amount": 0.0, "label": None}
    pct = round(amount / total * 100, 2) if total else None
    if pct is not None and abs(total * pct / 100 - amount) <= 1:
        return {"kind": "pct", "pct": pct, "amount": amount, "label": f"Diskon {pct:g}%"}
    return {"kind": "amount", "pct": None, "amount": amount, "label": "Diskon"}


def _header(rec: Record, q: PdfQuote) -> None:
    """Number, date, reference and contact as the PDF prints them."""
    if q.number:
        rec["number"]["original"] = q.number
    if q.date:
        rec["date"], rec["date_source"] = q.date.isoformat(), "pdf"
        rec["year"] = q.date.year
    rec["client_ref"] = q.your_ref
    rec["client_ref_source"] = "pdf" if q.your_ref else None
    if q.attn:
        rec["contact"] = {
            "name": q.attn,
            "email": q.email,
            "phone": None if q.email != rec["contact"].get("email") else rec["contact"]["phone"],
        }


def _retotal(rec: Record) -> None:
    """Computed totals for the PDF's lines, on the record's own tax setup."""
    c = rec["computed_totals"]
    rec["computed_totals"] = compute_totals(
        rec["lines"], rec["discount"], c["ppn_rate"], c["dpp"] is not None, []
    )


def take_pdf(rec: Record, q: PdfQuote) -> None:
    """The issued PDF's lines, discount and header replace the workbook's."""
    rec["lines"] = pdf_lines(q, rec["lines"])
    rec["discount"] = _discount(q)
    _header(rec, q)
    _retotal(rec)
    rec["flags"].append("lines_from_pdf")


def _overwritten_header(rec: Record) -> bool:
    """The file name and the PDF agree on a number the workbook no longer prints."""
    n = rec["number"]
    pdf, file = _digits(n.get("pdf")), _digits(n.get("file"))
    return bool(pdf and pdf == file and pdf != _digits(n.get("original")))


def _changed_after_pdf(rec: Record) -> bool:
    return any(r.get("cause") == "workbook_changed_after_pdf" for r in rec["reconciliation"])


def _version_base(pdf: Record, q: PdfQuote, kept: list[Record]) -> Record | None:
    """The quotation an unmatched PDF is a version of: same number, nearest date."""
    digits = _digits(q.number or pdf["number"])
    same = [r for r in kept if digits and _digits(r["number"]["original"]) == digits]
    if not same or q.date is None:
        return None
    when = q.date
    return min(same, key=lambda r: abs((when - date.fromisoformat(r["date"] or "9999-12-31")).days))


def _issued_grand(r: Record) -> float | None:
    """The grand total a record stands for: its PDF's once its lines are the PDF's."""
    if {"lines_from_pdf", "pdf_only_version"} & set(r.get("flags") or []):
        return (r.get("pdf") or {}).get("grand")
    return (r.get("print_totals") or {}).get("grand")


def _represented(q: PdfQuote, chain: list[Record]) -> bool:
    grands = [_issued_grand(r) for r in chain]
    return any(g is not None and q.grand is not None and abs(g - q.grand) <= 1 for g in grands)


def _chain(base: Record, kept: list[Record]) -> list[Record]:
    group = (base.get("revision") or {}).get("group")
    if group is None:
        return [base]
    return [r for r in kept if (r.get("revision") or {}).get("group") == group]


def _rechain(chain: list[Record], root: Path) -> None:
    """Order a revision chain by date, then by when each PDF was made."""

    def key(r: Record) -> tuple[str, str]:
        pdf = (r.get("pdf") or {}).get("path")
        return r["date"] or "9999", pdf_created(root / pdf) if pdf else ""

    chain.sort(key=key)
    base = chain[0]
    group = (base.get("revision") or {}).get("group") or (
        f"{base['year']}:{_digits(base['number']['original'])}:{base['client']['name']}:pdf"
    )
    for i, r in enumerate(chain):
        r["revision"] = {"group": group, "index": i, "count": len(chain), "base_id": base["id"]}


def pdf_version(base: Record, pdf: Record, q: PdfQuote) -> Record:
    """A version that exists only as a PDF, built on the quotation it revises."""
    rec = copy.deepcopy(base)
    rec.update(
        {
            "id": pdf["path"],
            "source": {
                "files": [pdf["path"]],
                "kind": "pdf",
                "sheet": None,
                "print_sheet": None,
                "modified": None,
            },
            "pdf": pdf,
            "aliases": [],
            "related_to": [],
            "duplicates": [],
            "reconciliation": [],
            "notes": [],
            "print_line_diffs": [],
            "print_totals": {"grand": q.grand, "gross": q.items_total, "rows": q.totals},
            "flags": ["pdf_only_version"],
        }
    )
    rec["number"] = {
        "original": q.number,
        "print": q.number,
        "sheet": None,
        "file": None,
        "pdf": q.number,
    }
    rec["lines"] = pdf_lines(q, base["lines"])
    rec["discount"] = _discount(q)
    _header(rec, q)
    _retotal(rec)
    return rec


def apply_issued_pdfs(kept: list[Record], unmatched: list[Record], root: Path) -> list[Record]:
    """Apply the three cases; return what could not be read, for the report."""
    unread: list[Record] = []
    for rec in kept:
        pdf = rec.get("pdf")
        if not pdf or not (_overwritten_header(rec) or _changed_after_pdf(rec)):
            continue
        q = parse_pdf_quote(pdf_text(root / pdf["path"]) or "")
        if _overwritten_header(rec):
            _header(rec, q)
            rec["flags"].append("header_from_pdf")
        if not _changed_after_pdf(rec):
            continue
        if trusted(q, pdf["grand"]):
            take_pdf(rec, q)
        else:
            rec["flags"].append("pdf_lines_unread")
            unread.append({"path": pdf["path"], "number": pdf["number"], "why": "edited after"})
    for pdf in unmatched:
        if pdf.get("status") != "no workbook":
            continue
        q = parse_pdf_quote(pdf_text(root / pdf["path"]) or "")
        base = _version_base(pdf, q, kept)
        if base is None or not trusted(q, pdf["grand"]):
            unread.append({"path": pdf["path"], "number": pdf["number"], "why": "version"})
            continue
        chain = _chain(base, kept)
        if _represented(q, chain):
            pdf["status"] = "already imported"
            continue
        rec = pdf_version(base, pdf, q)
        kept.append(rec)
        chain.append(rec)
        _rechain(chain, root)
        pdf["status"] = f"imported as a version of {base['number']['original']}"
    return unread
