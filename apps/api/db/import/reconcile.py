"""Reconcile parsed quotations with the PDFs and the survey oracles.

The PDF archive (its printed number, date and grand total, extracted by
the survey into pdf.tsv) is what clients received. Each record's
computed totals are compared with its PRINT block and its PDF, and every
difference above Rp 1 gets a cause.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

from values import parse_date

Record = dict[str, Any]

TOLERANCE = 1.0
FIELDS = ("gross", "discount", "net", "dpp", "ppn", "grand")


def parse_rupiah(text: str) -> int | None:
    """Read "Grand Total Rp 343.008.830" (or "Rp -" for zero)."""
    m = re.search(r"Rp\.?\s*(\d[\d.]*|-)", text or "")
    if m is None:
        return None
    return 0 if m.group(1) == "-" else int(m.group(1).replace(".", ""))


_PDF_TOTAL = re.compile(r"^\s*(GRAND\s+)?TOTAL\b.*?Rp\.?\s*(\d[\d.]*|-)\s*$", re.I | re.M)


def pdf_grand_from_text(text: str) -> int | None:
    """The last Total or Grand Total row of a quotation PDF's text."""
    found = _PDF_TOTAL.findall(text)
    if not found:
        return None
    value = found[-1][1]
    return 0 if value == "-" else int(value.replace(".", ""))


def pdf_text(path: Path) -> str | None:
    """A PDF's text by pdftotext, or None when it or the file is missing."""
    if shutil.which("pdftotext") is None or not path.exists():
        return None
    return subprocess.run(
        ["pdftotext", "-layout", str(path), "-"],
        capture_output=True,
        text=True,
        check=False,
    ).stdout


def fill_pdf_totals(pdfs: list[Record], root: Path) -> int:
    """Read missing grand totals from the PDFs with pdftotext; return how many."""
    filled = 0
    for pdf in pdfs:
        if pdf["grand"] is not None:
            continue
        text = pdf_text(root / pdf["path"])
        if text is None:
            continue
        grand = pdf_grand_from_text(text)
        if grand is not None:
            pdf["grand"] = grand
            pdf["grand_source"] = "pdftotext"
            filled += 1
    return filled


def _tokens(s: str | None) -> set[str]:
    return set(re.findall(r"[A-Z0-9]+", (s or "").upper()))


def _first_line(s: str | None) -> str:
    return next((x for x in (s or "").splitlines() if x.strip()), "")


def _line_in(ln: Record, words: set[str]) -> bool:
    """Whether a line's item appears in a PDF's words.

    Only the first line of the request and offer counts (notes below it
    rarely print). Part numbers decide when the line has them: half of
    its codes (letters with digits, or three digits or more) must be
    printed. Otherwise nearly all its words, short numbers included, must
    be, since a bare "30" also prints as "30 Days".
    """
    tokens = _tokens(_first_line(ln.get("request"))) | _tokens(_first_line(ln.get("offer")))
    coded = {t for t in tokens if re.search(r"\d", t) and (len(t) >= 3 or re.search("[A-Z]", t))}
    if coded:
        return len(coded & words) >= max(1, len(coded) / 2)
    plain = {t for t in tokens if len(t) >= 3 or t.isdigit()}
    return bool(plain) and len(plain & words) >= 0.8 * len(plain)


def content_in_pdf(rec: Record, text: str) -> bool:
    """Whether any of the record's lines is printed on the PDF."""
    words = _tokens(text)
    return any(_line_in(ln, words) for ln in rec["lines"])


def pdf_grand_differs(rec: Record) -> bool:
    pdf = rec.get("pdf") or {}
    grand = pdf.get("grand")
    return grand is not None and abs(round(rec["computed_totals"]["grand"]) - grand) > TOLERANCE


def classify_unmatched(unmatched: list[Record], records: list[Record]) -> None:
    """Say why each unattached PDF has no record of its own.

    A PDF printing the same number, date and total as an attached one is
    a copy of it; one with the same total under another number is listed
    with it (a PDF printing another workbook's total); anything else has no
    workbook.
    """
    attached = [r["pdf"] for r in records if r.get("pdf")]
    for pdf in unmatched:
        same = next(
            (
                a
                for a in attached
                if a["grand"] is not None and a["grand"] == pdf["grand"] and a["grand"] > 0
            ),
            None,
        )
        if same is None:
            pdf["status"] = "no workbook"
        elif _num(same["number"]) == _num(pdf["number"]) and same["date"] == pdf["date"]:
            pdf["status"] = f"copy of {same['path']}"
        else:
            pdf["status"] = f"same grand total as {same['path']} ({same['number']})"


def load_pdf_index(path: Path) -> list[Record]:
    """Load pdf.tsv: path, printed number, date, pages, grand total."""
    out: list[Record] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        cols = (line.split("\t") + [""] * 5)[:5]
        when = parse_date(cols[2])
        out.append(
            {
                "path": re.sub(r"^\./", "", cols[0]),
                "number": cols[1].strip() or None,
                "date": when.isoformat() if when else None,
                "pages": int(cols[3]) if cols[3].strip().isdigit() else None,
                "grand": parse_rupiah(cols[4]),
            }
        )
    return out


def _num(s: str | None) -> str:
    return re.sub(r"\s+", "", (s or "").upper())


def _stem(path: str) -> str:
    name = path.rsplit("/", 1)[-1]
    name = re.sub(r"(\.xlsx)?\.(pdf|xlsx)$", "", name, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", name).strip().upper()


def _pick(cands: list[Record], pdf: Record) -> Record | None:
    if not cands:
        return None
    if len(cands) > 1 and pdf["grand"] is not None:
        by_grand = [
            r
            for r in cands
            if (r.get("print_totals") or {}).get("grand") is not None
            and abs(round(r["print_totals"]["grand"]) - pdf["grand"]) <= TOLERANCE
        ]
        cands = by_grand or cands
    if len(cands) > 1:
        stem = _stem(pdf["path"])
        by_stem = [r for r in cands if any(_stem(f).startswith(stem) for f in r["source"]["files"])]
        cands = by_stem or cands
    return cands[0]


def _numbers(r: Record) -> set[str]:
    """The record's printed number and those of the copies merged into it."""
    found = {_num(r["number"]["original"])}
    found |= {_num(a.get("number")) for a in r.get("aliases", []) if a.get("number")}
    return found


def _candidates(records: list[Record], pdf: Record, by_name: bool) -> list[Record]:
    """Free records a PDF may belong to, by printed number and date or by file name."""
    free = [r for r in records if r.get("pdf") is None]
    if not by_name:
        return [r for r in free if _num(pdf["number"]) in _numbers(r) and r["date"] == pdf["date"]]
    stem = _stem(pdf["path"])
    return [r for r in free if any(_stem(f).startswith(stem) for f in r["source"]["files"])]


def _grand_matches(r: Record, pdf: Record) -> bool:
    grand = (r.get("print_totals") or {}).get("grand")
    return grand is not None and pdf["grand"] is not None and abs(round(grand) - pdf["grand"]) <= 1


def attach_pdfs(records: list[Record], pdfs: list[Record]) -> list[Record]:
    """Attach each PDF to its record; return the PDFs left unmatched.

    A PDF's candidates share its printed number and date, or else its file
    name. PDFs whose grand total equals a candidate's PRINT total are
    attached first, and within each pass every number match goes before
    any file-name match, so a PDF never takes the record another PDF
    proves (Q-669's file name on a PDF printing Q-654).
    """
    pending = list(pdfs)
    for exact in (True, False):
        for by_name in (False, True):
            left = []
            for pdf in pending:
                cands = _candidates(records, pdf, by_name)
                if exact:
                    cands = [r for r in cands if _grand_matches(r, pdf)]
                rec = _pick(cands, pdf)
                if rec is None:
                    left.append(pdf)
                    continue
                rec["pdf"] = pdf
                rec["number"]["pdf"] = pdf["number"]
                if by_name:
                    rec["flags"].append("pdf_matched_by_file_name")
                if _num(pdf["number"]) != _num(rec["number"]["original"]):
                    # The PDF is what the client received; the owner decides.
                    rec["flags"].append("pdf_number_ne_print")
            pending = left
    return pending


def _record_cause(p: Record, c: Record, rec: Record) -> str | None:
    printed = [p[f] for f in FIELDS if p.get(f) is not None]
    if printed and all(v == 0 for v in printed) and c["gross"]:
        if "print_price_list" in rec["flags"]:
            return "print_total_zero_price_list"
        return "print_totals_zero"
    return None


def _field_cause(field: str, p: Record, c: Record, rec: Record) -> str:
    dpp, ppn, grand = p.get("dpp"), p.get("ppn"), p.get("grand")
    template_grand = dpp and ppn is not None and grand is not None
    if field == "grand" and template_grand and abs(grand - (dpp + ppn)) <= TOLERANCE:
        return "print_grand_is_dpp_plus_ppn"
    gross_differs = p.get("gross") is not None and abs(p["gross"] - c["gross"]) > TOLERANCE
    if field == "gross":
        diffs = rec.get("print_line_diffs") or []
        shift = sum(d["data_amount"] - d["print_amount"] for d in diffs)
        if diffs and abs(shift - (c["gross"] - p["gross"])) <= TOLERANCE:
            return "print_line_amounts_differ"
        return "line_amounts_differ"
    if p.get(field) == 0 and c.get(field):
        return "print_field_zero"
    if gross_differs:
        return "follows_gross_difference"
    if field == "discount":
        return "discount_differs"
    if field in ("ppn", "dpp", "grand", "net") and p.get("ppn") is not None and p.get("gross"):
        rate = c.get("ppn_rate") or 0
        if (
            rate
            and abs(p["ppn"] - p["gross"] * rate / 100) <= TOLERANCE
            and (p.get("discount") or 0)
        ):
            return "print_ppn_on_pre_discount_amount"
    if field in ("ppn", "dpp", "grand") and c.get("dpp") is None and p.get("dpp") is not None:
        return "dpp_rule_differs"
    return "unexplained"


def compare_totals(rec: Record) -> list[Record]:
    """Every computed total that differs from PRINT or the PDF by more than Rp 1."""
    c = rec["computed_totals"]
    p = rec.get("print_totals")
    out: list[Record] = []
    if p is not None:
        whole = _record_cause(p, c, rec)
        for field in FIELDS:
            if p.get(field) is None or c.get(field) is None:
                continue
            diff = c[field] - p[field]
            if abs(diff) > TOLERANCE:
                out.append(
                    {
                        "field": field,
                        "source": "print",
                        "computed": c[field],
                        "other": p[field],
                        "diff": diff,
                        "cause": whole or _field_cause(field, p, c, rec),
                    }
                )
    pdf = rec.get("pdf")
    if pdf and pdf.get("grand") is not None and abs(round(c["grand"]) - pdf["grand"]) > TOLERANCE:
        print_grand = (p or {}).get("grand")
        same_as_print = (
            print_grand is not None and abs(round(print_grand) - pdf["grand"]) <= TOLERANCE
        )
        if not same_as_print:
            if rec.get("pdf_content") is False:
                cause = "workbook_holds_other_content"
            elif pdf["grand"] == 0:
                cause = "pdf_total_zero"
            elif print_grand is not None:
                cause = "workbook_changed_after_pdf"
            else:
                cause = "pdf_differs_no_print_total"
            out.append(
                {
                    "field": "grand",
                    "source": "pdf",
                    "computed": c["grand"],
                    "other": pdf["grand"],
                    "diff": c["grand"] - pdf["grand"],
                    "cause": cause,
                }
            )
    return out


def compare_print_oracle(printed: Record | None, entry: Record) -> list[Record]:
    """Differences between our PRINT block and the survey's (disc.json).

    The survey's "sub" is the first Sub Total on the sheet, a page
    subtotal on multi-page prints, so only discount, DPP, PPN and grand
    are compared.
    """
    out: list[Record] = []
    for field, key in (("discount", "disc"), ("dpp", "dpp"), ("ppn", "ppn"), ("grand", "grand")):
        if key not in entry:
            continue
        label, value = entry[key]
        ours = (printed or {}).get(field)
        if value is None:
            continue
        if ours is None or abs(abs(ours) - abs(value)) > TOLERANCE:
            out.append({"field": field, "ours": ours, "oracle": value, "label": label})
    return out
