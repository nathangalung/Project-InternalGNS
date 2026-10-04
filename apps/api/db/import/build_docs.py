"""Build pos.json and invoices.json from the client PO and invoice files.

Usage: GNS_DATA_DIR=<Data/Data> uv run build_docs.py

Pelita portal orders and the DO and invoice workbooks are read
mechanically (docs_extract.py); photographed and scanned orders, the
quotation each PO came from, and every keep-or-drop decision come from
local/docs_manifest.py. Each PO's lines are then looked up by price in its
quotation workbook, so the evidence records the quotation row behind
every line. Run validate_docs.py on the result.
"""

from __future__ import annotations

import csv
import importlib.util
import io
import json
import re
import sys
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from types import ModuleType
from typing import Any

from docs_extract import (
    InvoiceDoc,
    PortalOrder,
    Quote,
    QuoteRow,
    parse_pelita_order,
    pdf_text,
    plain,
    read_do_file,
    read_do_units,
    read_invoice_file,
    read_quote_file,
    workbook_cells,
)
from paths import INVOICES_FILE, MANIFEST_FILE, OUT_DIR, POS_FILE, data_dir

Doc = dict[str, Any]

REVIEW_FILE = OUT_DIR / "review_docs.csv"


def load_manifest(path: Path = MANIFEST_FILE) -> ModuleType | None:
    """The hand-made manifest in local/, or None on a fresh clone."""
    if not path.is_file():
        return None
    spec = importlib.util.spec_from_file_location("docs_manifest", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# Every builder below reads the manifest through this name.
m: Any = load_manifest()


def po_id(client: str, number: str | None, key: str | None = None) -> str:
    return f"{client}:{number or key}"


def iso(d: date | None) -> str | None:
    return d.isoformat() if d else None


# PO builders
def pelita_po(spec: Doc, root: Path) -> Doc:
    order: PortalOrder = parse_pelita_order(pdf_text(root / spec["pdf"]))
    refs = [f"Offer No. {order.offer_no}" if order.offer_no else None]
    refs.append(f"Order No. {order.order_no}" if order.order_no else None)
    city = order.city.rstrip(",") if order.city else None
    return {
        "id": po_id("pelita", order.ref_no),
        "client": m.CLIENTS["pelita"],
        "client_printed": "PT Pelita Global Logistik",
        "client_po_number": order.ref_no,
        "client_po_number_missing_reason": None,
        "po_date": iso(order.order_date),
        "po_date_source": "document",
        "user_end": order.vessel,
        "delivery_place": None if not city or city.startswith("Not selected") else city,
        "payment_terms": order.payment_terms,
        "rfq_date": iso(order.rfq_date),
        "client_reference": "; ".join(r for r in refs if r) or None,
        "lines": [
            {
                "no": ln.position,
                "code": ln.code,
                "description": ln.description,
                "remark": ln.remark,
                "supplier_remark": ln.supplier_remark,
                "qty": ln.qty,
                "unit": ln.unit,
                "unit_price": ln.unit_price,
                "amount": ln.amount,
            }
            for ln in order.lines
        ],
        "charges": [{"label": label, "amount": amt} for label, amt in order.charges],
        "subtotal": order.price,
        "discount": order.rebate,
        "discount_label": f"Rebate {plain(order.rebate_pct)}%",
        "dpp_basis": "net",
        "untaxed": Decimal(0),
        "dpp": order.sub_total,
        "ppn_rate": order.vat_pct,
        "ppn": order.vat,
        "total": order.total,
        "source_kind": "po_file",
        "transcription": "text",
        "source_files": [{"path": spec["pdf"], "part": None}],
        "notes": m.PELITA_NOTES.get(order.ref_no, []),
        "corrections": [],
    }


def manual_po(spec: Doc) -> Doc:
    lines = [{"no": i, **ln} for i, ln in enumerate(spec["lines"], start=1)]
    subtotal = sum((Decimal(ln["amount"]) for ln in lines), Decimal(0))
    discount = Decimal(spec.get("discount") or 0)
    untaxed = Decimal(spec.get("untaxed") or 0)
    basis = spec["dpp_basis"]
    dpp = spec.get("dpp") if basis == "nilai_lain" else None
    if basis == "net":
        dpp = subtotal - discount - untaxed
    return {
        "id": po_id(spec["client"], spec["number"]),
        "client": m.CLIENTS[spec["client"]],
        "client_printed": spec.get("client_printed"),
        "client_po_number": spec["number"],
        "client_po_number_missing_reason": None,
        "po_date": spec["po_date"],
        "po_date_source": "document",
        "user_end": spec.get("user_end"),
        "delivery_place": spec.get("delivery_place"),
        "payment_terms": spec.get("payment_terms"),
        "client_reference": spec.get("client_reference"),
        "lines": lines,
        "charges": [],
        "subtotal": subtotal,
        "discount": discount,
        "dpp_basis": basis,
        "untaxed": untaxed,
        "dpp": dpp,
        "ppn_rate": spec["ppn_rate"],
        "ppn": spec["ppn"],
        "total": spec["total"],
        "tax_note": spec.get("tax_note"),
        "source_kind": "po_file",
        "transcription": spec["transcription"],
        "source_files": [{"path": s["path"], "part": s.get("part")} for s in spec["sources"]],
        "notes": spec.get("notes", []),
        "corrections": [],
    }


def invoice_only_po(spec: Doc, inv: InvoiceDoc) -> Doc:
    if any(c["field"] != "po_date" for c in spec.get("corrections", [])):
        raise ValueError(f"{spec['invoice']}: only po_date can be corrected on this PO")
    fix = next((c for c in spec.get("corrections", []) if c["field"] == "po_date"), None)
    corrections: list[Doc] = []
    if fix:
        corrections.append(
            {
                "field": "po_date",
                "printed": iso(inv.po_date),
                "value": fix["value"],
                "reason": fix["reason"],
            }
        )
        po_date, source = fix["value"], "correction"
    elif inv.po_date:
        po_date, source = iso(inv.po_date), "invoice"
    else:
        billed = [d for d in (inv.do_date, inv.invoice_date) if d]
        po_date, source = iso(min(billed)), "billing_fallback"
    if spec["number"] is None and not spec.get("number_missing_reason"):
        raise ValueError(f"{spec['invoice']}: no PO number and no number_missing_reason")
    notes = list(spec.get("notes", []))
    if spec.get("related_po"):
        notes.append(f"Related goods PO: {spec['related_po']}.")
    return {
        "id": po_id(spec["client"], spec["number"], spec.get("key")),
        "client": m.CLIENTS[spec["client"]],
        "client_printed": inv.client,
        "client_po_number": spec["number"],
        "client_po_number_missing_reason": spec.get("number_missing_reason"),
        "po_date": po_date,
        "po_date_source": source,
        "user_end": None,
        "delivery_place": None,
        "payment_terms": None,
        "client_reference": None,
        "related_client_po": spec.get("related_po"),
        **invoice_amounts(inv, Decimal(0)),
        "source_kind": "invoice_only",
        "transcription": "workbook",
        "source_files": [{"path": spec["invoice"], "part": None}],
        "notes": [
            "No PO document in Data: lines and amounts are the invoice's, the only record "
            "of this order.",
            *notes,
        ],
        "corrections": corrections,
    }


def invoice_amounts(inv: InvoiceDoc, untaxed: Decimal) -> Doc:
    taxable = inv.subtotal - inv.discount - untaxed
    return {
        "lines": [
            {
                "no": i,
                "description": ln.description,
                "qty": ln.qty,
                "unit": ln.unit,
                "unit_price": ln.unit_price,
                "amount": ln.amount,
            }
            for i, ln in enumerate(inv.lines, start=1)
        ],
        "charges": [],
        "subtotal": plain(inv.subtotal),
        "discount": plain(inv.discount),
        "dpp_basis": "net",
        "untaxed": untaxed,
        "dpp": plain(taxable),
        "ppn_rate": inv.ppn_rate,
        "ppn": plain(inv.ppn),
        "total": plain(inv.total),
    }


# Quotation evidence
def priced_rows(quote: Quote) -> list[int]:
    """Rows that offer something at a price above zero."""
    if quote.price_column:
        return [r.row for r in quote.rows if r.price]
    return [r.row for r in quote.rows if r.qty is not None and any(n >= 100 for n in r.numbers)]


def pick_row(
    quotes: dict[str, Quote],
    files: list[str],
    ln: Doc,
    used: set[tuple[str, int]],
    pinned: int | None,
) -> tuple[str, QuoteRow] | None:
    """The quotation row behind a PO line: pinned, else same price."""
    if pinned is not None:
        row = next(r for r in quotes[files[0]].rows if r.row == pinned)
        return files[0], row
    price, qty = Decimal(ln["unit_price"]), Decimal(ln["qty"])
    cands = [(f, r) for f in files for r in quotes[f].rows_priced(price)]
    fresh = [c for c in cands if (c[0], c[1].row) not in used]
    same = [c for c in fresh if c[1].qty == qty]
    return (same or fresh or cands or [None])[0]


def base_number(printed: str | None) -> str | None:
    """A printed quotation number without its -O (offer) suffix."""
    return re.sub(r"-O(?=/)", "", printed) if printed else None


def check_relation(relation: str, main: str | None, other: str | None, same: bool) -> None:
    """Fail unless the files bear out the declared sibling relation."""
    same_number = base_number(main) == base_number(other)
    holds = {
        "copy": same,
        "earlier_version": same_number and not same,
        "different_number": not same_number,
    }.get(relation, False)
    if not holds:
        raise ValueError(
            f"relation {relation!r} does not hold: {main} vs {other}, cells equal: {same}"
        )


def sibling_entries(main_file: str, main: Quote, sibs: list[Doc], root: Path) -> list[Doc]:
    out: list[Doc] = []
    cells = workbook_cells(root / main_file) if sibs else {}
    for s in sibs:
        other = read_quote_file(root / s["path"])
        same = workbook_cells(root / s["path"]) == cells
        check_relation(s["relation"], main.printed_number, other.printed_number, same)
        out.append(
            {
                **s,
                "printed_number": other.printed_number,
                "printed_date": iso(other.printed_date),
            }
        )
    return out


def quote_evidence(po: Doc, spec: Doc, root: Path) -> Doc:
    """Find each PO line's price in the quotation workbooks."""
    files = [spec["file"], *spec.get("others", [])]
    quotes = {f: read_quote_file(root / f) for f in files}
    pins: dict[int, int] = spec.get("rows", {})
    used: set[tuple[str, int]] = set()
    lines: list[Doc] = []
    differences: list[str] = []
    for ln in po["lines"]:
        price, qty = Decimal(ln["unit_price"]), Decimal(ln["qty"])
        if price == 0:
            lines.append({"po_line": ln["no"], "status": "unpriced"})
            continue
        pick = pick_row(quotes, files, ln, used, pins.get(ln["no"]))
        if pick is None:
            lines.append({"po_line": ln["no"], "status": "not_in_quotation"})
            differences.append(f"line {ln['no']}: price {price:,} is in no quoted row")
            continue
        f, row = pick
        used.add((f, row.row))
        entry: Doc = {
            "po_line": ln["no"],
            "quote_row": row.row,
            "quote_qty": row.qty,
            "quote_price": row.price,
        }
        if f != spec["file"]:
            entry["quote_file"] = f
        status = []
        if row.price is not None and row.price != price:
            status.append("price_differs")
            differences.append(f"line {ln['no']}: price {price:,} against quoted {row.price:,}")
        if row.qty != qty:
            status.append("qty_differs")
            differences.append(f"line {ln['no']}: qty {qty} against quoted {row.qty}")
        entry["status"] = "+".join(status) or "same"
        entry["quote_text"] = (row.text or "").split("\n")[0][:90] or None
        lines.append(entry)
    main = quotes[spec["file"]]
    charges: list[Doc] = []
    for ch in po.get("charges") or []:
        rows = [
            r for r in main.rows_priced(Decimal(ch["amount"])) if (spec["file"], r.row) not in used
        ]
        if rows:
            used.add((spec["file"], rows[0].row))
            charges.append({"charge": ch["label"], "quote_row": rows[0].row})
        else:
            charges.append({"charge": ch["label"], "quote_row": None})
            differences.append(f"charge {ch['label']}: {ch['amount']:,} is in no quoted row")
    unused = [r for r in priced_rows(main) if (spec["file"], r) not in used]
    if differences:
        match = "differs"
    elif unused:
        match = "subset"
    else:
        match = "exact"
    return {
        "file": spec["file"],
        "printed_number": main.printed_number,
        "printed_date": iso(main.printed_date),
        "other_files": [
            {
                "file": f,
                "printed_number": quotes[f].printed_number,
                "printed_date": iso(quotes[f].printed_date),
            }
            for f in spec.get("others", [])
        ],
        "sibling_files": sibling_entries(spec["file"], main, spec.get("siblings", []), root),
        "changed_after_order": spec.get("changed_after_order"),
        "match": match,
        "matched_by": "sell price column" if main.price_column else "any numeric cell",
        "differences": differences,
        "unordered_quote_rows": unused,
        "evidence": spec["evidence"],
        "lines": lines,
        "charges": charges,
    }


def attach_quotation(po: Doc, spec: Doc, root: Path) -> Doc:
    qspec = spec.get("quotation")
    synthetic = spec.get("synthetic_quotation")
    po["quotation"] = quote_evidence(po, qspec, root) if qspec else None
    po["quotation_missing_reason"] = spec.get("quotation_missing_reason")
    # Dated on the order: nothing earlier is known
    po["synthetic_quotation"] = {"date": po["po_date"], **synthetic} if synthetic else None
    gone = (synthetic or {}).get("overwritten_file")
    if gone:
        now = read_quote_file(root / gone["path"])
        if (now.printed_number, iso(now.printed_date)) != (
            gone["prints_number"],
            gone["prints_date"],
        ):
            raise ValueError(f"{gone['path']}: prints {now.printed_number} {now.printed_date}")
    kind = "single" if qspec else "synthetic" if synthetic else "none"
    po["link"] = spec.get("link") or {"kind": kind}
    return po


# Invoice builder
def build_invoice(spec: Doc, inv: InvoiceDoc, po: Doc, root: Path) -> Doc:
    corrections: list[Doc] = []
    inv_date, due = inv.invoice_date, inv.due_date
    if inv_date is None:
        raise ValueError(f"{spec['file']}: no invoice date")
    fixes = {c["field"]: c for c in spec.get("corrections", [])}
    if fixes and (spec.get("year_typo") or spec.get("due_typo") or set(fixes) - DATE_FIELDS):
        raise ValueError(f"{spec['file']}: corrections take only dates, without typo flags")
    if "invoice_date" in fixes:
        fixed = date.fromisoformat(fixes["invoice_date"]["value"])
        corrections.append(
            correction("invoice_date", inv_date, fixed, fixes["invoice_date"]["reason"])
        )
        inv_date = fixed
    if "due_date" in fixes:
        fixed = date.fromisoformat(fixes["due_date"]["value"])
        corrections.append(correction("due_date", due, fixed, fixes["due_date"]["reason"]))
        due = fixed
    if spec.get("year_typo") and inv_date.year == 2025:
        fixed = inv_date.replace(year=2026)
        corrections.append(
            correction("invoice_date", inv_date, fixed, "Year typo: a 2026 invoice dated 2025.")
        )
        inv_date = fixed
    if (spec.get("year_typo") or spec.get("due_typo")) and due and due.year == 2025:
        fixed = due.replace(year=2026)
        corrections.append(correction("due_date", due, fixed, "Year typo in the due date."))
        due = fixed
    if spec.get("due_derived") and due is None:
        due = inv_date + timedelta(days=30)
        corrections.append(
            correction(
                "due_date",
                None,
                due,
                "Not printed; invoice date + 30 days, as on the other invoices.",
            )
        )
    do_numbers, do_date = inv.do_numbers, inv.do_date
    do_source = None
    if spec.get("do_from"):
        do_source = f"{m.INV}/{spec['do_from']}"
        do_numbers, do_date = read_do_file(root / do_source)
    extra_dos: list[Doc] = []
    for extra in spec.get("extra_dos", []):
        source = f"{m.INV}/{extra['file']}"
        numbers, when = read_do_file(root / source)
        if extra["number"] not in numbers:
            raise ValueError(f"{source}: DO sheet does not print {extra['number']}")
        extra_dos.append({"number": extra["number"], "date": iso(when), "source_file": source})
    printed_po = inv.po_number
    if printed_po in m.PRINTED_PO_VARIANTS:
        actual, why = m.PRINTED_PO_VARIANTS[printed_po]
        corrections.append(
            {"field": "po_number", "printed": printed_po, "value": actual, "reason": why}
        )
    notes = list(spec.get("notes", []))
    if len(inv.invoice_numbers) > 1:
        notes.append(f"Also prints {', '.join(inv.invoice_numbers[1:])} on a later page.")
    return {
        "invoice_number": inv.invoice_numbers[0],
        "do_number": do_numbers[0] if do_numbers else None,
        "invoice_date": iso(inv_date),
        "due_date": iso(due),
        "do_date": iso(do_date),
        "do_source_file": do_source,
        "extra_dos": extra_dos,
        "po_id": po["id"],
        "client": po["client"],
        "client_printed": inv.client,
        "buyer": (
            {"name": inv.buyer.name, "address": inv.buyer.address, "npwp": inv.buyer.npwp}
            if inv.buyer
            else None
        ),
        "po_number_printed": printed_po,
        "po_date_printed": iso(inv.po_date),
        **invoice_amounts(inv, Decimal(spec.get("untaxed", 0))),
        "po_difference": spec.get("po_difference"),
        "source_file": f"{m.INV}/{spec['file']}",
        "companion_files": [f"{m.INV}/{c}" for c in spec.get("companions", [])],
        "corrections": corrections,
        "notes": notes,
    }


DATE_FIELDS = {"invoice_date", "due_date"}


def correction(field: str, printed: date | None, value: date, reason: str) -> Doc:
    return {"field": field, "printed": iso(printed), "value": iso(value), "reason": reason}


# Assembly
def only_po(spec: Doc, number: str, candidates: list[Doc]) -> Doc:
    """The one PO an invoice's printed number names, by client when shared."""
    if spec.get("client"):
        client = m.CLIENTS[spec["client"]]
        candidates = [p for p in candidates if p["client"] == client]
    if len(candidates) != 1:
        raise ValueError(
            f"{spec['file']}: {len(candidates)} POs for printed number {number!r}; "
            "set the invoice's client in the manifest"
        )
    return candidates[0]


def units_from_do(inv: InvoiceDoc, units: list[str | None]) -> None:
    """Give invoice lines without a unit the one their DO sheet prints."""
    if len(units) != len(inv.lines):
        return
    for ln, unit in zip(inv.lines, units, strict=True):
        if ln.unit is None and unit:
            ln.unit = unit


def build(root: Path) -> tuple[Doc, Doc]:
    pos = [attach_quotation(pelita_po(spec, root), spec, root) for spec in m.PELITA_POS]
    pos += [attach_quotation(manual_po(spec), spec, root) for spec in m.MANUAL_POS]
    read = {spec["file"]: read_invoice_file(root / m.INV / spec["file"]) for spec in m.INVOICES}
    for spec in m.INVOICES:
        if spec.get("do_from"):
            units_from_do(read[spec["file"]], read_do_units(root / m.INV / spec["do_from"]))
    by_invoice_file: dict[str, Doc] = {}
    for spec in m.INVOICE_ONLY_POS:
        name = Path(spec["invoice"]).name
        po = attach_quotation(invoice_only_po(spec, read[name]), spec, root)
        pos.append(po)
        by_invoice_file[name] = po
    by_number: dict[str, list[Doc]] = defaultdict(list)
    for po in pos:
        if po["client_po_number"]:
            by_number[po["client_po_number"]].append(po)
    invoices: list[Doc] = []
    for spec in m.INVOICES:
        inv = read[spec["file"]]
        po = by_invoice_file.get(spec["file"])
        if po is None:
            number = inv.po_number or ""
            number = m.PRINTED_PO_VARIANTS.get(number, (number, ""))[0]
            po = only_po(spec, number, by_number[number])
        invoices.append(build_invoice(spec, inv, po, root))
    pos.sort(key=lambda p: (p["po_date"] or "", p["id"]))
    pos_doc = {
        "about": "Client purchase orders from Data/PO/PO CLIENT, plus orders known only "
        "from the invoice that bills them. Paths are relative to GNS_DATA_DIR. Built by "
        "build_docs.py from docs_manifest.py; checked by validate_docs.py.",
        "pos": pos,
        "dropped": m.DROPPED_POS,
    }
    inv_doc = {
        "about": "Invoices and their delivery orders from Data/Invoice/DO & INVOICE 2026, "
        "amounts as printed. Built by build_docs.py; checked by validate_docs.py.",
        "invoices": invoices,
        "dropped": [
            {**d, "file": f"{m.INV}/{d['file']}"}
            | ({"kept": f"{m.INV}/{d['kept']}"} if d.get("kept") else {})
            for d in m.DROPPED_INVOICES
        ],
    }
    return pos_doc, inv_doc


def to_json(obj: object) -> object:
    if isinstance(obj, Decimal):
        return int(obj) if obj == obj.to_integral_value() else float(obj)
    if isinstance(obj, dict):
        return {k: to_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [to_json(v) for v in obj]
    if isinstance(obj, float):
        return int(obj) if obj.is_integer() else obj
    return obj


def dump(doc: Doc) -> str:
    return json.dumps(to_json(doc), ensure_ascii=False, indent=2) + "\n"


def review_csv(pos_doc: Doc, inv_doc: Doc) -> str:
    """One row per PO: its quotation link and what differs, for a human pass."""
    billed: dict[str, list[str]] = {}
    for inv in inv_doc["invoices"]:
        billed.setdefault(inv["po_id"], []).append(inv["invoice_number"])
    out = io.StringIO()
    w = csv.writer(out, lineterminator="\n")
    w.writerow(
        [
            "po_id",
            "po_date",
            "source_kind",
            "link",
            "quotation_file",
            "quotation_printed_number",
            "match",
            "differences",
            "invoices",
            "total",
            "flags",
        ]
    )
    for po in pos_doc["pos"]:
        q = po["quotation"] or {}
        flags = []
        if po["po_date_source"] != "document":
            flags.append(f"po_date:{po['po_date_source']}")
        if not po["client_po_number"]:
            flags.append("no_po_number")
        if q.get("changed_after_order"):
            flags.append(f"quotation_changed_after_order:{q['changed_after_order']['kind']}")
        if po["synthetic_quotation"] and po["synthetic_quotation"].get("overwritten_file"):
            flags.append("quotation_workbook_overwritten")
        w.writerow(
            [
                po["id"],
                po["po_date"] or "",
                po["source_kind"],
                po["link"]["kind"],
                Path(q["file"]).name if q else "",
                q.get("printed_number") or "",
                q.get("match") or po["quotation_missing_reason"],
                "; ".join(q.get("differences", [])),
                " ".join(billed.get(po["id"], [])),
                to_json(po["total"]),
                " ".join(flags),
            ]
        )
    return out.getvalue()


def main() -> int:
    root = data_dir()
    if not root.is_dir():
        print(f"GNS_DATA_DIR {root} not found", file=sys.stderr)
        return 1
    if m is None:
        print(f"{MANIFEST_FILE} not found: restore local/ from its backup", file=sys.stderr)
        return 1
    OUT_DIR.mkdir(exist_ok=True)
    pos_doc, inv_doc = build(root)
    POS_FILE.write_text(dump(pos_doc), encoding="utf-8")
    INVOICES_FILE.write_text(dump(inv_doc), encoding="utf-8")
    REVIEW_FILE.parent.mkdir(exist_ok=True)
    REVIEW_FILE.write_text(review_csv(pos_doc, inv_doc), encoding="utf-8")
    print(f"{len(pos_doc['pos'])} POs, {len(inv_doc['invoices'])} invoices written")
    return 0


if __name__ == "__main__":
    sys.exit(main())
