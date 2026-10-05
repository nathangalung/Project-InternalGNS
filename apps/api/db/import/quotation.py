"""Build normalised quotation records from one workbook.

A record carries what the import needs (client, contact, date, terms,
discount, lines) plus the evidence behind it: source files, every
number the workbook prints, the PRINT totals block, computed totals
and flags for anything that needed a judgement.
"""

from __future__ import annotations

import re
from dataclasses import replace
from datetime import date
from pathlib import Path
from typing import Any

import openpyxl

from scan import FileName, parse_file_name
from sheets import (
    Grid,
    Line,
    PrintInfo,
    PrintTotals,
    Skipped,
    load_grid,
    map_columns,
    read_header,
    read_lines,
    read_print,
)
from unit_map import map_unit
from values import (
    canonical_client,
    clean_text,
    impa_codes_in_text,
    is_no_offer,
    norm_label,
    parse_date,
    parse_impa,
)

Record = dict[str, Any]

# Lines

_VENDOR_NOISE = re.compile(r"^\s*(?:Rp\.?|[\W_]+)\s*$")


def _vendor(v: str | None) -> str | None:
    if v is None or len(v.strip()) < 3 or _VENDOR_NOISE.match(v):
        return None
    return v


def _no_offer_note(*texts: str | None) -> str | None:
    for t in texts:
        if is_no_offer(t):
            assert t is not None
            rest = re.sub(r"^\s*no\s*(offer|stock)\b[\s.,:;-]*", "", t, flags=re.IGNORECASE)
            return clean_text(rest)
    return None


def _units_priced(
    amount: float, sell: float | None, cost: float | None, cost_amount: float | None
) -> float | None:
    """The quantity both amounts were computed for, when it is not the typed one.

    Q-528 asks for 3 sensors but prices the 1 available: harga jual and
    harga beli amounts both equal one unit. Without a harga beli amount
    to confirm it, the typed quantity stands and the unit price gives way.
    """
    if not sell or not cost or not cost_amount or sell <= 0 or cost <= 0:
        return None
    units = amount / sell
    if units < 1 or abs(units - round(units)) > 1e-6 or abs(cost_amount / cost - units) > 1e-6:
        return None
    return float(round(units))


# A request typed on a numbered row and answered on the unnumbered,
# priced rows below it: "Offer:" closes the request text.
_OFFER_LEAD = re.compile(r"(\n|\s)*offer\s*:?\s*$", re.IGNORECASE)


def _priced(ln: Line) -> bool:
    return bool(ln.sell) or bool(ln.sell_amount)


def _first_text_line(s: str | None) -> str:
    return (s or "").strip().split("\n")[0].strip()


def _offer_row(parent: Line, row: Line, several: bool) -> Line:
    """One priced answer to a request row, as a line of its own."""
    request = _OFFER_LEAD.sub("", parent.request or "").strip() or parent.request
    answer = clean_text(row.offer or row.request)
    if several:
        heading = _first_text_line(parent.offer or request).rstrip(" :")
        option = re.sub(r"^[\s\-:]+", "", answer or "")
        answer = f"{heading} - {option}" if heading and option else answer or heading
    return replace(
        row,
        no=parent.no,
        qty=row.qty if row.qty is not None else parent.qty,
        unit=row.unit or parent.unit,
        request=request,
        offer=answer,
        impa=row.impa if row.impa not in (None, "", 0) else parent.impa,
        nama_asli=row.nama_asli or parent.nama_asli,
        vendor=row.vendor or parent.vendor,
        channel=row.channel or parent.channel,
    )


def merge_offer_rows(lines: list[Line]) -> tuple[list[Line], list[Line]]:
    """Join request rows with the priced rows that answer them.

    A numbered row without a price followed by unnumbered priced rows is
    one request: one answer becomes one line (request and IMPA from the
    numbered row, offer, quantity and prices from the answer); several
    answers (options, sizes, the signs under a heading) become one line
    each, named after the request. A numbered row with no quantity or
    price whose text ends in a colon is a heading, never a line; it is
    returned apart.
    """
    out: list[Line] = []
    headings: list[Line] = []
    i = 0
    while i < len(lines):
        ln = lines[i]
        answers: list[Line] = []
        j = i + 1
        while j < len(lines) and lines[j].no is None and _priced(lines[j]):
            answers.append(lines[j])
            j += 1
        unpriced = ln.no is not None and not _priced(ln) and not ln.cost
        if unpriced and answers:
            out.extend(_offer_row(ln, a, len(answers) > 1) for a in answers)
            i = j
            continue
        text = (ln.request or ln.offer or "").rstrip()
        if unpriced and ln.qty is None and text.endswith(":"):
            headings.append(ln)
        else:
            out.append(ln)
        i += 1
    return out, headings


def _unit_counted(units: float, *texts: str | None) -> str | None:
    """The unit a text counts the priced quantity in: "(40 roll)" for 40."""
    pattern = re.compile(rf"\(\s*{round(units)}\s*([A-Za-z]+)\s*\)")
    for t in texts:
        m = pattern.search(t or "")
        if m:
            code, mapped = map_unit(m.group(1))
            if mapped:
                return code
    return None


def normalize_line(ln: Line, has_amount: bool) -> Record:
    """Turn a sheet line into a record line with flags.

    The printed amount wins over qty x unit price when they disagree, so
    line totals add up to what the client saw; a priced row with no
    amount is listed but kept out of the totals.
    """
    flags: list[str] = []
    request = ln.request or ln.offer
    offer = ln.offer
    available = not (
        is_no_offer(ln.offer)
        or is_no_offer(ln.nama_asli)
        or (ln.offer is None and is_no_offer(ln.request))
    )
    offer_note = None
    if not available:
        offer_note = _no_offer_note(ln.offer, ln.nama_asli, ln.request)
        offer = None

    impa, problem = parse_impa(ln.impa)
    in_text: list[str] = []
    for code in impa_codes_in_text(request) + impa_codes_in_text(ln.offer):
        if code not in in_text:
            in_text.append(code)
    if problem:
        flags.append(f"impa_{problem}")
    if impa and in_text and impa not in in_text:
        flags.append("impa_text_differs")

    unit, mapped = map_unit(ln.unit)
    if ln.unit and not mapped:
        flags.append("unit_unmapped")
    if ln.unit is None:
        flags.append("unit_missing")

    qty = ln.qty
    sell = ln.sell
    sell_printed = ln.sell
    amount = ln.sell_amount
    cost = ln.cost
    in_total = True
    if qty is None and amount is not None and amount < 0:
        qty = 1.0
    if qty is None:
        flags.append("qty_missing")
    elif qty == 0:
        flags.append("qty_zero")

    if not available:
        if sell:
            flags.append("no_offer_with_price")
        sell, line_total = 0.0, 0.0
    elif has_amount and amount is not None and amount != 0:
        line_total = amount
        if amount < 0:
            flags.append("negative_amount")
            sell = amount / qty if qty else amount
        elif qty and (sell is None or abs(qty * sell - amount) > 1):
            units = _units_priced(amount, sell, ln.cost, ln.cost_amount)
            if units is not None:
                qty = units
                flags.append("qty_from_amount")
                counted = _unit_counted(units, request, ln.offer)
                if counted is None and unit == "DOZ" and ln.qty and units == ln.qty * 12:
                    counted = "PCS"  # a dozen priced as twelve pieces
                if counted is not None:
                    unit, mapped = counted, True
                    flags.append("unit_from_text")
                else:
                    flags.append("unit_unverified")
            else:
                ratio = amount / (qty * sell) if sell else None
                sell = amount / qty
                flags.append("unit_price_from_amount")
                if cost and ratio and not ln.cost_amount:
                    cost = cost * ratio
                    flags.append("cost_rescaled_with_price")
    else:
        line_total = (qty or 0) * (sell or 0)
        if has_amount and line_total:
            in_total, line_total = False, 0.0
            flags.append("not_in_amount_column")
    if sell is None:
        flags.append("sell_missing")
    if cost is None and ln.cost_amount and qty:
        cost = ln.cost_amount / qty
        flags.append("cost_from_amount")
    if sell and cost and sell > 0 and cost > 0 and sell / cost > 50:
        flags.append("price_ratio_suspicious")

    return {
        "row": ln.row,
        "no_raw": ln.no,
        "qty": qty,
        "qty_raw": ln.qty,
        "unit_raw": ln.unit,
        "unit": unit,
        "unit_mapped": mapped,
        "request": request,
        "offer": offer,
        "offer_note": offer_note,
        "available": available,
        "impa": impa,
        "impa_raw": clean_text(ln.impa) if problem else None,
        "impa_problem": problem,
        "impa_in_text": in_text,
        "sell": sell,
        "sell_printed": sell_printed,
        "cost": cost,
        "line_total": line_total,
        "in_total": in_total,
        "nama_asli": ln.nama_asli,
        "vendor": _vendor(ln.vendor),
        "channel": ln.channel,
        "flags": flags,
    }


# Discount and totals


def _is_round_pct(pct: float) -> bool:
    return abs(pct * 2 - round(pct * 2)) < 0.01


def resolve_discount(t: PrintTotals | None, gross: float, flags: list[str]) -> Record:
    """Read the PRINT discount as a percentage or a fixed rupiah amount."""
    none = {"kind": "none", "pct": None, "amount": 0.0, "label": None}
    if t is None or t.discount_label is None:
        return none
    amount = t.discount or 0.0
    label = t.discount_label
    pct = t.discount_pct_label
    base = t.gross if t.gross else gross
    if amount == 0:
        if pct:
            flags.append("discount_label_without_amount")
        return {**none, "label": label}
    if pct is not None:
        if base and abs(base * pct / 100 - amount) <= 1:
            return {"kind": "pct", "pct": pct, "amount": amount, "label": label}
        flags.append("discount_label_pct_mismatch")
        return {"kind": "amount", "pct": None, "amount": amount, "label": label}
    if base:
        inferred = amount / base * 100
        if _is_round_pct(inferred) and abs(base * round(inferred, 1) / 100 - amount) <= 1:
            flags.append("discount_pct_inferred")
            return {"kind": "pct", "pct": round(inferred, 1), "amount": amount, "label": label}
    return {"kind": "amount", "pct": None, "amount": amount, "label": label}


def compute_totals(
    lines: list[Record],
    discount: Record,
    ppn_rate: float,
    dpp_nilai_lain: bool,
    extras: list[tuple[str, float, bool]],
) -> Record:
    """Totals the way the PRINT sheet computes them, unrounded."""
    gross = sum(ln["line_total"] for ln in lines if ln["in_total"])
    pct = discount["kind"] == "pct"
    disc = gross * discount["pct"] / 100 if pct else (discount["amount"] or 0.0)
    net = gross - disc + sum(v for _, v, taxed in extras if taxed)
    dpp = net * 11 / 12 if dpp_nilai_lain else None
    ppn = (dpp if dpp is not None else net) * ppn_rate / 100
    grand = net + ppn + sum(v for _, v, taxed in extras if not taxed)
    return {
        "gross": gross,
        "discount": disc,
        "net": net,
        "dpp": dpp,
        "ppn_rate": ppn_rate,
        "ppn": ppn,
        "grand": grand,
    }


# Vessel, numbers and terms

_VESSEL_PREFIX = re.compile(r"^(MV|M/V|TB|TUG\s*BOAT|BG|FC|KM|LCT|SPOB|MT)\.?(\s|:|$)", re.I)
_NOT_VESSEL_NAMES = {"REPAIR", "STORE", "SPAREPART", "SPARE PART"}
_VESSEL_LEAD = re.compile(
    r"^(SHIP|VESSEL|UNTUK\s*KAPAL|UNTUK|FOR|KAPAL)\b\s*:?\s*(VESSEL\b\s*)?", re.IGNORECASE
)


def vessel_from_text(text: str | None, known: set[str] | None = None) -> str | None:
    """Return the vessel named by a PRINT row or file-name part, if any."""
    if not text:
        return None
    s = re.sub(r"\s+", " ", text).strip()
    lead = _VESSEL_LEAD.match(s)
    rest = s[lead.end() :].strip() if lead else s
    rest = re.sub(r"^(MV|TB)\s*:\s*", r"\1 ", rest, flags=re.IGNORECASE).strip()
    m = _VESSEL_PREFIX.match(rest)
    if m:
        name = rest[m.end() :].strip(" :.")
        # "TB Repair" names a job on a tugboat, not a vessel.
        return rest if name and name.upper() not in _NOT_VESSEL_NAMES else None
    if lead and rest and len(rest) <= 40:
        return rest
    if known and rest.upper() in known:
        return rest
    return None


def split_vessel_lead(text: str | None) -> tuple[str | None, str | None]:
    """Split a vessel name typed above the first item into its request cell.

    "MV YUXIN SATU\\n\\nHAMMER CHIPPING ..." gives the vessel and the
    request; a cell that is only a vessel, or names none first, is kept.
    """
    if not text:
        return None, text
    first, _, rest = text.partition("\n")
    rest = rest.strip()
    if (
        rest
        and vessel_from_text(first.strip())
        and first.strip().upper().startswith(("MV", "M/V", "TB", "KM", "BG", "MT"))
    ):
        return first.strip(), rest
    return None, text


def _strip_vessel_lead(lines: list[Line]) -> tuple[list[Line], str | None]:
    if not lines:
        return lines, None
    vessel, request = split_vessel_lead(lines[0].request)
    if vessel is None:
        return lines, None
    return [replace(lines[0], request=request), *lines[1:]], vessel


_ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"]
_PRINTED = re.compile(r"^Q-?(\d+)(?:-([A-Z0-9]{1,2}))?/([^/]+)/([IVX]+)/(\d{4})$")


def number_flags(
    printed: str | None,
    when: date | None,
    file_number: str | None,
    folder_year: int | None,
) -> list[str]:
    """Sanity checks on the printed quotation number against its date."""
    flags: list[str] = []
    if printed is None:
        flags.append("number_missing")
    else:
        m = _PRINTED.match(printed.replace(" ", ""))
        digits = re.match(r"^Q-?(\d+)", printed)
        if m is None or m.group(3) != "GNS":
            flags.append("number_malformed")
        n = digits.group(1) if digits else None
        year = when.year if when else folder_year
        if n and year:
            ok = {3} if year <= 2024 else ({6} if year == 2025 else {6, 7})
            if len(n) not in ok:
                flags.append("number_digits_unusual")
        if m and when:
            if m.group(4) in _ROMAN and _ROMAN.index(m.group(4)) + 1 != when.month:
                flags.append("number_month_ne_date")
            if int(m.group(5)) != when.year:
                flags.append("number_year_ne_date")
        if when and folder_year and when.year != folder_year:
            flags.append("date_year_ne_folder")
        if n and file_number and n != file_number:
            flags.append("file_number_ne_printed")
        return flags
    if when is None:
        flags.append("date_missing")
    return flags


def parse_days(text: str | None) -> int | None:
    """Read "3 days" or "30 Days" as a day count."""
    if not text:
        return None
    m = re.search(r"(\d+)\s*(working\s*)?(days?|hari)", text, re.IGNORECASE)
    return int(m.group(1)) if m else None


# Workbook records

_FILE_CLIENT_ALIASES = {
    "NGK": "PT. Niterra Mobility Indonesia",
    "IMC": "PT. IMC Ship Management",
    "PELITA": "PT. Pelita Global Logistik",
    "SOLUSI": "PT. Solusi Pelayaran Nusantara",
    "LUMOSO": "PT. Lumoso Pratama Line",
    "INDOGLAS": "PT. Indoglas Jaya",
}


def client_from_file(hint: str | None) -> str | None:
    """Resolve the client written in a file name, including short names."""
    if not hint:
        return None
    c = canonical_client(hint.replace("_", "/"))
    if c is not None:
        return c.name
    for word in re.findall(r"[A-Za-z]+", hint.upper()):
        if word in _FILE_CLIENT_ALIASES:
            return _FILE_CLIENT_ALIASES[word]
    return None


_SIGNING_LINE = re.compile(r"^\s*Jakarta\s*,\s*\d", re.IGNORECASE)


def is_signing_line(text: str | None) -> bool:
    """An empty DELIVERY TIME row picks up the signing line beside it."""
    return bool(text and _SIGNING_LINE.match(text))


def _folder_year(rel: str) -> int | None:
    m = re.search(r"Quotation (\d{4})", rel)
    return int(m.group(1)) if m else None


def _meaningful_ref(ref: str | None) -> str | None:
    if ref is None or ref.strip(" :-") == "":
        return None
    return ref


def _file_number(fn: FileName) -> str | None:
    if fn.number is None:
        return None
    return f"Q-{fn.number}" + (f"-{fn.suffix}" if fn.suffix else "")


def _iso(d: date | None) -> str | None:
    return d.isoformat() if d else None


def _print_totals(t: PrintTotals | None) -> Record | None:
    if t is None:
        return None
    return {
        "gross": t.gross,
        "discount": t.discount,
        "discount_label": t.discount_label,
        "net": t.net,
        "dpp": t.dpp,
        "ppn_label": t.ppn_label,
        "ppn_rate": t.ppn_rate,
        "ppn": t.ppn,
        "grand": t.grand,
        "extras": [{"label": lab, "amount": v, "taxed": taxed} for lab, v, taxed in t.extras],
        "rows": [[lab, v] for lab, v in t.rows],
    }


def _text_key(s: str | None) -> str:
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())[:40]


def _match_print_lines(lines: list[Record], printed: list[Line]) -> list[tuple[Record, Line]]:
    """Pair DATA lines with PRINT rows: same text and price first, then text."""
    unused = list(printed)
    pairs: list[tuple[Record, Line]] = []
    for exact in (True, False):
        for ln in lines:
            if any(ln is a for a, _ in pairs):
                continue
            keys = {_text_key(ln["request"]), _text_key(ln["offer"])} - {""}
            price = ln["sell_printed"] if ln["sell_printed"] is not None else ln["sell"]
            for p in unused:
                same_text = bool(keys & {_text_key(p.request), _text_key(p.offer)})
                same_price = p.sell is None or price is None or abs(p.sell - price) <= 1
                if same_text and (same_price or not exact):
                    pairs.append((ln, p))
                    unused.remove(p)
                    break
    return pairs


def _apply_print_no_offer(lines: list[Record], pr: PrintInfo) -> None:
    """Mark lines unavailable where the PRINT sheet shows them as No Offer.

    Some templates leave the DATA ENTRI offer cell at 0 and let a PRINT
    formula print "No Offer", so the PRINT row is the evidence.
    """
    offered = [ln for ln in lines if ln["available"]]
    for ln, p in _match_print_lines(offered, pr.lines):
        if is_no_offer(p.offer) or (p.offer is None and is_no_offer(p.request)):
            if ln["sell"]:
                ln["flags"].append("priced_line_printed_as_no_offer")
            ln["available"] = False
            ln["offer"] = None
            ln["offer_note"] = _no_offer_note(p.offer, p.request)
            ln["sell"], ln["line_total"] = 0.0, 0.0
            ln["flags"].append("no_offer_on_print")


def _apply_print_line_set(lines: list[Record], pr: PrintInfo, flags: list[str]) -> list[Record]:
    """Keep DATA lines the PRINT sheet did not total out of the totals.

    A line is a candidate when PRINT lacks it, lists it with a price but
    no amount, or it is an unnumbered kit component. Candidates are
    excluded only when that makes the line sum equal the printed gross,
    so the PRINT sheet is the evidence. A PRINT total of zero proves
    nothing (a price list of options, or amounts left blank), so every
    line stays and the record is flagged. Returns the lines whose printed
    amount differs from the DATA amount, as evidence for the report.
    """
    t = pr.totals
    if t is None or t.gross is None or not pr.lines:
        return []
    gross = sum(ln["line_total"] for ln in lines if ln["in_total"])
    if abs(gross - t.gross) <= 1:
        return []
    if abs(t.gross) <= 1:
        priced = [p for p in pr.lines if p.sell]
        price_list = bool(priced) and not any(p.sell_amount for p in pr.lines)
        flags.append("print_price_list" if price_list else "print_total_zero")
        return []
    live = [ln for ln in lines if ln["in_total"] and ln["line_total"]]
    pairs = _match_print_lines(live, pr.lines)
    matched = {id(ln): p for ln, p in pairs}
    why: dict[int, str] = {}
    for ln in live:
        p = matched.get(id(ln))
        if p is None:
            why[id(ln)] = "not_on_print"
        elif p.sell and not p.sell_amount:
            why[id(ln)] = "no_amount_on_print"
        elif ln["no_raw"] is None:
            why[id(ln)] = "kit_component_not_totalled"
    missing = [ln for ln in live if why.get(id(ln)) == "not_on_print"]
    unamounted = [ln for ln in live if why.get(id(ln)) == "no_amount_on_print"]
    components = [ln for ln in live if why.get(id(ln)) == "kit_component_not_totalled"]
    for group in (
        missing + unamounted,
        missing,
        unamounted,
        components,
        missing + unamounted + components,
    ):
        if group and abs(gross - sum(ln["line_total"] for ln in group) - t.gross) <= 1:
            for ln in group:
                ln["in_total"] = False
                ln["line_total"] = 0.0
                ln["flags"].append(why[id(ln)])
            flags.append("lines_not_totalled_on_print")
            return []
    return [
        {"row": ln["row"], "data_amount": ln["line_total"], "print_amount": p.sell_amount}
        for ln, p in pairs
        if p.sell_amount is not None and abs(p.sell_amount - ln["line_total"]) > 1
    ]


def _tax_setup(
    t: PrintTotals | None, year: int, flags: list[str]
) -> tuple[float, bool, list[tuple[str, float, bool]]]:
    """PPN rate, DPP Nilai Lain use and block charges, as the PRINT sheet has them.

    Without PRINT values the period rule applies: 11% on the net to 2024,
    12% on DPP Nilai Lain (11/12 of the net) from 2025. A block without a
    PPN row, or with PPN printed as zero, charges none. A charge counts as
    taxed when the printed net already includes it; withheld PPh never is.
    """
    if t is None:
        return (11.0 if year <= 2024 else 12.0), year >= 2025, []
    rate = t.ppn_rate or (11.0 if year <= 2024 else 12.0)
    if t.ppn_label is None:
        rate = 0.0
        flags.append("no_ppn_on_print")
    elif t.ppn == 0 and (t.gross or 0) > 0:
        rate = 0.0
        flags.append("ppn_zero_on_print")
    charges = [e for e in t.extras if not norm_label(e[0]).startswith("PPH")]
    withheld = [e for e in t.extras if norm_label(e[0]).startswith("PPH")]
    if charges and t.net is not None and t.gross is not None:
        residual = t.net - (t.gross - (t.discount or 0))
        if abs(residual - sum(v for _, v, _ in charges)) <= 1:
            charges = [(lab, v, True) for lab, v, _ in charges]
        elif abs(residual) <= 1:
            charges = [(lab, v, False) for lab, v, _ in charges]
    has_dpp = any(norm_label(label).startswith("DPP") for label, _ in t.rows)
    return rate, rate > 0 and has_dpp, charges + withheld


def _sheet_pairs(names: list[str]) -> tuple[list[tuple[str, str | None]], list[str]]:
    """Pair each DATA sheet with its PRINT sheet; list the other sheets."""
    data = [n for n in names if norm_label(n).startswith("DATA")]
    prints = [n for n in names if norm_label(n).startswith("PRINT")]
    pairs: list[tuple[str, str | None]] = []
    for d in data:
        suffix = re.sub(r"^DATA(ENTRI|ENTRY)?", "", norm_label(d))
        match = [
            p
            for p in prints
            if re.sub(r"^PRINT(HORIZONTAL|VERTIKAL)?", "", norm_label(p)) == suffix
        ]
        pairs.append((d, match[0] if match else None))
    paired = {p for _, p in pairs}
    others = [n for n in names if n not in data and n not in paired]
    return pairs, others


_REVISION_SHEET = re.compile(r"\brev(isi|ised|ision)?\b", re.IGNORECASE)


def _extra_sheet(name: str, pr: PrintInfo, own: str | None, has_data: bool) -> str | None:
    """How to treat a quotation print sheet beside the DATA/PRINT pair.

    Returns "revision" for a revised print ("Print revisi"), "ignore" for
    a custom layout of the file's own quotation, or "separate" for another
    quotation embedded in the workbook.
    """
    if _REVISION_SHEET.search(name):
        return "revision"
    sheet_digits = re.match(r"^Q-?(\d+)", name.strip())
    printed_digits = re.match(r"^Q-?(\d+)", pr.number or "")
    own_sheet = sheet_digits is not None and sheet_digits.group(1) == own
    if has_data and (own_sheet or (printed_digits and printed_digits.group(1) == own)):
        return "ignore"
    return "separate"


def _is_quotation_print(pr: PrintInfo) -> bool:
    return bool(pr.number and re.match(r"^Q-?\d", pr.number) and pr.columns and pr.lines)


def _base_record(rel: str, fn: FileName, kind: str, sheet: str, print_sheet: str | None) -> Record:
    return {
        "id": f"{rel}#{sheet}",
        "source": {"files": [rel], "kind": kind, "sheet": sheet, "print_sheet": print_sheet},
        "file_name": {
            "number": _file_number(fn),
            "refs": fn.refs,
            "parts": fn.parts,
            "client_hint": fn.client_hint,
            "notes": fn.notes,
            "markers": list(fn.markers),
        },
        "revision_of": None,
        "excluded_sheets": [],
    }


def _finish(
    rec: Record,
    rel: str,
    fn: FileName,
    customer: str | None,
    printed: str | None,
    sheet_number: str | None,
    when: date | None,
    date_source: str | None,
    contact: Record,
    pr: PrintInfo | None,
    lines: list[Record],
    extra_texts: list[str],
    flags: list[str],
) -> Record:
    folder_year = _folder_year(rel)
    client = canonical_client(customer)
    if client is None and pr is not None and pr.to:
        client = canonical_client(pr.to)
        if client is not None:
            flags.append("client_from_print")
    file_client = client_from_file(fn.client_hint)
    if client is None and file_client is not None:
        flags.append("client_from_file_name")
        client_rec = {
            "name": file_client,
            "raw": fn.client_hint,
            "broker_note": None,
            "individual": False,
        }
    elif client is None:
        flags.append("client_unknown")
        client_rec = {"name": None, "raw": customer, "broker_note": None, "individual": False}
    else:
        client_rec = {
            "name": client.name,
            "raw": customer if customer else (pr.to if pr else None),
            "broker_note": client.broker_note,
            "individual": client.individual,
        }
        if client.individual:
            flags.append("individual_client")
        if file_client and file_client != client.name:
            flags.append("file_client_differs")

    file_number = fn.number
    flags.extend(number_flags(printed or sheet_number, when, file_number, folder_year))
    if printed and sheet_number and printed.replace(" ", "") != sheet_number.replace(" ", ""):
        flags.append("print_number_ne_sheet")

    # A workbook saved under another quotation's name and client (Q-499's
    # file holds Isna Agung's Q-502): the name says nothing about it.
    file_parts, file_refs = fn.parts, fn.refs
    if {"file_client_differs", "file_number_ne_printed"} <= set(flags):
        flags.append("file_name_describes_other_quotation")
        file_parts, file_refs = [], []

    ref = _meaningful_ref(pr.your_ref if pr else None)
    ref_source = "print" if ref else None
    if ref is None and file_refs:
        ref, ref_source = ", ".join(file_refs), "file"

    vessel, vessel_source = None, None
    for source, texts in (("print", pr.pre_rows if pr else []), ("data", extra_texts)):
        for text in texts:
            vessel = vessel_from_text(text)
            if vessel:
                vessel_source = source
                break
        if vessel:
            break
    if vessel is None:
        for part in file_parts:
            vessel = vessel_from_text(part)
            if vessel:
                vessel_source = "file"
                break
    candidates = (pr.pre_rows if pr else []) + extra_texts + file_parts

    header_time = contact.pop("delivery_time", None)
    header_place = contact.pop("delivery_place", None)
    payment = pr.payment if pr else None
    validity = pr.validity if pr else None
    delivery_time = (pr.delivery_time if pr else None) or header_time
    if is_signing_line(delivery_time):
        delivery_time = None
        flags.append("delivery_time_is_signing_date")
    terms = {
        "delivery_time": delivery_time,
        "delivery_place": (pr.delivery_place if pr else None) or header_place,
        "payment": payment,
        "payment_days": parse_days(payment),
        "validity": validity,
        "validity_days": parse_days(validity),
    }

    totals = pr.totals if pr else None
    if pr is not None and pr.lines:
        _apply_print_no_offer(lines, pr)
    line_diffs = _apply_print_line_set(lines, pr, flags) if pr is not None else []
    gross = sum(ln["line_total"] for ln in lines if ln["in_total"])
    discount = resolve_discount(totals, gross, flags)
    year = when.year if when else (folder_year or 2025)
    # A lone label (a "Total Amount" column header) is not a totals block;
    # the labels of a real one count even when Excel cached no values.
    block = totals if totals is not None and len(totals.rows) >= 2 else None
    ppn_rate, dpp, extras = _tax_setup(block, year, flags)
    computed = compute_totals(lines, discount, ppn_rate, dpp, extras)

    if block is None:
        flags.append("print_totals_missing")
    elif block.gross is None and block.grand is None:
        flags.append("print_totals_not_cached")
    if not any(ln["sell"] for ln in lines if ln["available"]):
        flags.append("unpriced")
    if not lines:
        flags.append("no_lines")

    for i, ln in enumerate(lines, start=1):
        ln["line_no"] = i
    rec.update(
        {
            "year": year,
            "date": _iso(when),
            "date_source": date_source,
            "number": {
                "original": printed or sheet_number or _file_number(fn),
                "print": printed,
                "sheet": sheet_number,
                "file": _file_number(fn),
                "pdf": None,
            },
            "client": client_rec,
            "contact": contact,
            "client_ref": ref,
            "client_ref_source": ref_source,
            "vessel": vessel,
            "vessel_source": vessel_source,
            "vessel_candidates": candidates,
            "terms": terms,
            "discount": discount,
            "lines": lines,
            "extras": [{"label": lab, "amount": v, "taxed": taxed} for lab, v, taxed in extras],
            "print_totals": _print_totals(totals),
            "computed_totals": computed,
            "pdf": None,
            "notes": (pr.notes if pr else []) + fn.notes,
            "print_line_diffs": line_diffs,
            "revision": None,
            "duplicates": [],
            "flags": flags,
        }
    )
    return rec


def _data_record(
    rel: str, fn: FileName, data: Grid, sheet: str, pr: PrintInfo | None, print_sheet: str | None
) -> Record:
    rec = _base_record(rel, fn, "data_entry", sheet, print_sheet)
    flags: list[str] = []
    h = read_header(data)
    cols = map_columns(data)
    raw_lines: list[Line] = []
    skipped = []
    if cols is None:
        flags.append("item_table_not_found")
    else:
        raw_lines, skipped = read_lines(data, cols)
        raw_lines, headings = merge_offer_rows(raw_lines)
        skipped += [Skipped(h.row, "heading", clean_text(h.request) or "") for h in headings]
        flags.extend(cols.flags)
    has_amount = cols is not None and cols.sell_amount is not None
    raw_lines, lead_vessel = _strip_vessel_lead(raw_lines)
    lines = [normalize_line(ln, has_amount) for ln in raw_lines]
    if lead_vessel:
        lines[0]["flags"].append("vessel_lead_stripped")

    when = parse_date(h.date_raw)
    date_source = "data" if when else None
    if when is None and pr is not None:
        when = parse_date(pr.date_raw)
        date_source = "print" if when else None
    if not h.customer and not h.number and not h.date_raw:
        flags.append("header_empty")
    contact = {
        "name": h.contact or (pr.attn if pr else None),
        "email": h.email or (pr.email if pr else None),
        "phone": h.phone or (pr.phone if pr else None),
        "delivery_time": h.delivery_time,
        "delivery_place": h.delivery_place,
    }
    extra_texts = [s.text for s in skipped if s.reason == "text before first line"]
    if lead_vessel:
        extra_texts.append(lead_vessel)
    rec["skipped_rows"] = [{"row": s.row, "reason": s.reason, "text": s.text} for s in skipped]
    if pr is None:
        flags.append("print_sheet_missing")
    return _finish(
        rec,
        rel,
        fn,
        h.customer or (pr.to if pr else None),
        pr.number if pr else None,
        h.number,
        when,
        date_source,
        contact,
        pr,
        lines,
        extra_texts,
        flags,
    )


def _print_record(rel: str, fn: FileName, pr: PrintInfo, sheet: str) -> Record:
    rec = _base_record(rel, fn, "print_only", sheet, sheet)
    flags = ["print_only_source"]
    pr.lines, headings = merge_offer_rows(pr.lines)
    pr.skipped += [Skipped(h.row, "heading", clean_text(h.request) or "") for h in headings]
    pr.lines, vessel = _strip_vessel_lead(pr.lines)
    if vessel:
        pr.pre_rows.append(vessel)
    lines = [normalize_line(ln, True) for ln in pr.lines]
    if vessel:
        lines[0]["flags"].append("vessel_lead_stripped")
    when = parse_date(pr.date_raw)
    contact = {
        "name": pr.attn,
        "email": pr.email,
        "phone": pr.phone,
        "delivery_time": None,
        "delivery_place": None,
    }
    rec["skipped_rows"] = [{"row": s.row, "reason": s.reason, "text": s.text} for s in pr.skipped]
    return _finish(
        rec, rel, fn, pr.to, pr.number, None, when, "print" if when else None,
        contact, pr, lines, [], flags,
    )  # fmt: skip


def build_workbook(path: Path, root: Path) -> tuple[list[Record], str | None]:
    """Return the quotation records in one workbook, or why it has none."""
    rel = path.relative_to(root).as_posix()
    fn = parse_file_name(path.name)
    try:
        wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    except Exception as e:  # noqa: BLE001 - any open failure is reported, not raised
        return [], f"could not open: {type(e).__name__}: {e}"
    try:
        names = list(wb.sheetnames)
        modified = wb.properties.modified
        pairs, others = _sheet_pairs(names)
        records: list[Record] = []
        stale: list[Record] = []
        side: list[Record] = []
        for data_name, print_name in pairs:
            pr = read_print(load_grid(wb[print_name])) if print_name else None
            records.append(
                _data_record(rel, fn, load_grid(wb[data_name]), data_name, pr, print_name)
            )
        for name in others:
            label = norm_label(name)
            if pairs and not (re.match(r"^Q-?\d", name.strip()) or label.startswith("PRINT")):
                side += _side_sheet_lines(load_grid(wb[name]))
                continue  # PO, Label, Packing List and other side sheets
            pr = read_print(load_grid(wb[name]))
            if not _is_quotation_print(pr):
                continue
            kind = _extra_sheet(name, pr, fn.number, bool(pairs))
            if kind == "ignore":
                for r in records:
                    r["flags"].append(f"extra_print_sheet_ignored:{name}")
                continue
            rec = _print_record(rel, fn, pr, name)
            if kind == "revision":
                rec["file_name"]["markers"].append(f"sheet:{name}")
                if pairs and not _bind_revision(rec, records[: len(pairs)]):
                    stale.append(rec)
                    continue
                bound = next((r for r in records if r["id"] == rec["revision_of"]), None)
                _fill_costs(rec, side + (bound["lines"] if bound else []))
            records.append(rec)
    finally:
        wb.close()

    if not records:
        return [], "not a quotation (no DATA ENTRI sheet and no quotation print sheet)"
    for r in records:
        # Saved time inside the workbook; the disk time is the copy's.
        r["source"]["modified"] = modified.isoformat() if modified else None
    if all(not r["lines"] for r in records):
        if fn.number and fn.number.endswith("000"):
            return [], "blank template (number 000, no lines)"
        return [], "no item lines"
    kept = [r for r in records if r["lines"]]
    dropped = [(r, "empty sheet: no item lines") for r in records if not r["lines"]]
    dropped += [(r, "stale revision sheet: no line in common with DATA ENTRI") for r in stale]
    for sheet_rec, reason in dropped:
        name = sheet_rec["source"]["sheet"]
        flag = "empty_sheet_dropped" if sheet_rec["lines"] == [] else "stale_revision_sheet"
        for r in kept:
            r["flags"].append(f"{flag}:{name}")
            r["excluded_sheets"].append(
                {
                    "sheet": name,
                    "reason": reason,
                    "number": sheet_rec["number"]["original"],
                    "client": sheet_rec["client"]["name"],
                    "lines": len(sheet_rec["lines"]),
                    "grand": sheet_rec["computed_totals"]["grand"],
                }
            )
    return kept, None


def _side_sheet_lines(g: Grid) -> list[Record]:
    """Priced lines of a side sheet laid out like DATA ENTRI (the PO sheet)."""
    cols = map_columns(g)
    if cols is None or cols.cost is None:
        return []
    lines, _ = read_lines(g, cols)
    return [normalize_line(ln, cols.sell_amount is not None) for ln in lines]


def _fill_costs(rec: Record, sources: list[Record]) -> None:
    """Give a print-only revision the harga beli and vendor its workbook holds.

    A revised print sheet carries no costs; the workbook's purchasing (PO)
    sheet or its DATA ENTRI lists the same lines with harga beli and
    vendor. A line takes them from the source with the same text, the one
    at the same harga jual first.
    """
    priced = [s for s in sources if s.get("cost")]
    for ln in rec["lines"]:
        if ln["cost"] is not None or not ln["available"]:
            continue
        keys = {_text_key(ln["request"]), _text_key(ln["offer"])} - {""}
        same = [s for s in priced if keys & {_text_key(s["request"]), _text_key(s["offer"])}]
        if not same:
            continue
        at_price = [
            s for s in same if s["sell"] and ln["sell"] and abs(s["sell"] - ln["sell"]) <= 1
        ]
        src = (at_price or same)[0]
        ln["cost"] = src["cost"]
        ln["vendor"] = ln["vendor"] or src["vendor"]
        ln["channel"] = ln["channel"] or src["channel"]
        ln["nama_asli"] = ln["nama_asli"] or src["nama_asli"]
        ln["flags"].append("cost_from_workbook")


def _line_keys(r: Record) -> set[str]:
    return {_text_key(ln["request"]) for ln in r["lines"]} - {""}


def _bind_revision(rec: Record, data_records: list[Record]) -> bool:
    """Tie a revised print sheet to the DATA record it revises.

    The sheet revises the DATA record it shares the most lines with. A
    sheet sharing no line with any of them is a stale copy left in the
    workbook (Q-655's "Print revisi" still holds Q-502's lines), so it
    is not a revision of anything here.
    """
    keys = _line_keys(rec)
    best = max(data_records, key=lambda d: len(keys & _line_keys(d)))
    if not keys & _line_keys(best):
        return False
    rec["revision_of"] = best["id"]
    return True
