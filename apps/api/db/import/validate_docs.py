"""Check pos.json and invoices.json for internal consistency.

Usage: uv run validate_docs.py [--no-files]

Arithmetic (lines, subtotal, discount, DPP, PPN, total), links (every
invoice names a PO of the same client, every PO names a quotation file or
says why it has none), uniqueness and dates. With GNS_DATA_DIR present,
every referenced source and quotation file must exist.
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any

from paths import INVOICES_FILE, POS_FILE, data_dir

CENT = Decimal("0.01")
Doc = dict[str, Any]

# document: the PO itself; invoice: printed on the invoice;
# correction: a recorded fix; billing_fallback: the earliest DO or
# invoice date, for orders known only from their invoice.
PO_DATE_SOURCES = ("document", "invoice", "correction", "billing_fallback")
SIBLING_RELATIONS = ("copy", "earlier_version", "different_number")


def dec(value: object) -> Decimal:
    if value is None:
        return Decimal(0)
    return Decimal(str(value))


def sen(value: Decimal) -> Decimal:
    return value.quantize(CENT, ROUND_HALF_UP)


# Amount checks
def check_amounts(doc: Doc, label: str) -> list[str]:
    """Line, subtotal, discount, DPP, PPN and total arithmetic."""
    errors: list[str] = []
    lines = doc.get("lines") or []
    if not lines:
        errors.append(f"{label}: has no lines")
    for ln in lines:
        want = sen(dec(ln["qty"]) * dec(ln["unit_price"]))
        if sen(dec(ln["amount"])) != want:
            errors.append(f"{label}: line {ln['no']} amount {ln['amount']} != qty x price {want}")
    line_sum = sum((dec(ln["amount"]) for ln in lines), Decimal(0))
    subtotal = dec(doc["subtotal"])
    if subtotal != line_sum:
        errors.append(f"{label}: subtotal {subtotal} != sum of lines {line_sum}")
    discount = dec(doc["discount"])
    line_disc = [dec(ln["discount"]) for ln in lines if "discount" in ln]
    if line_disc and sum(line_disc, Decimal(0)) != discount:
        errors.append(f"{label}: line discounts {sum(line_disc)} != discount {discount}")
    charges = sum((dec(c["amount"]) for c in doc.get("charges") or []), Decimal(0))
    taxable = subtotal - discount + charges - dec(doc.get("untaxed"))
    basis = doc["dpp_basis"]
    ppn = doc.get("ppn")
    rate = dec(doc.get("ppn_rate"))
    if basis == "none":
        if ppn is not None or doc.get("dpp") is not None:
            errors.append(f"{label}: tax-excluded document carries DPP or PPN")
    elif basis == "net":
        if dec(doc["dpp"]) != taxable:
            errors.append(f"{label}: DPP {doc['dpp']} != taxable base {taxable}")
        if sen(dec(ppn)) != sen(taxable * rate / 100):
            errors.append(f"{label}: PPN {ppn} != {rate}% of {taxable}")
    elif basis == "nilai_lain":
        if abs(dec(doc["dpp"]) - taxable * 11 / 12) >= 1:
            errors.append(f"{label}: DPP nilai lain {doc['dpp']} != 11/12 of {taxable}")
        if rate != 12 or sen(dec(ppn)) != sen(taxable * 11 / 100):
            errors.append(f"{label}: PPN {ppn} != 12% of DPP nilai lain on {taxable}")
    else:
        errors.append(f"{label}: unknown dpp_basis {basis!r}")
    total = subtotal - discount + charges + dec(ppn)
    if dec(doc["total"]) != total:
        errors.append(f"{label}: total {doc['total']} != {total}")
    return errors


# Cross checks
def missing(root: Path | None, rel: str) -> bool:
    return root is not None and not (root / rel).is_file()


def check_quotation(po: Doc, label: str, root: Path | None) -> list[str]:
    """The quotation link: dated before the order, files present."""
    errors: list[str] = []
    quote = po.get("quotation")
    po_date = po.get("po_date")
    if not quote:
        if not po.get("quotation_missing_reason"):
            errors.append(f"{label}: no quotation and no reason")
        synthetic = po.get("synthetic_quotation")
        if not synthetic or not synthetic.get("date") or not synthetic.get("reason"):
            errors.append(f"{label}: no quotation and no synthetic quotation spec")
        else:
            if po_date and synthetic["date"] > po_date:
                errors.append(f"{label}: synthetic quotation dated after its PO ({po_date})")
            if po.get("link", {}).get("kind") != "synthetic":
                errors.append(f"{label}: link kind must be 'synthetic'")
            gone = synthetic.get("overwritten_file") or {}
            errors += [
                f"{label}: overwritten quotation file missing: {rel}"
                for rel in (gone.get("path"), gone.get("same_as"))
                if rel and missing(root, rel)
            ]
        return errors
    if po.get("synthetic_quotation"):
        errors.append(f"{label}: both a quotation and a synthetic quotation")
    if missing(root, quote["file"]):
        errors.append(f"{label}: quotation file missing: {quote['file']}")
    dated = [(quote["file"], quote.get("printed_date"))]
    for other in quote.get("other_files") or []:
        if not isinstance(other, dict):
            errors.append(f"{label}: other quotation entry needs file and printed_date: {other}")
            continue
        dated.append((other["file"], other.get("printed_date")))
        if missing(root, other["file"]):
            errors.append(f"{label}: other quotation file missing: {other['file']}")
    for file, when in dated:
        if not when:
            errors.append(f"{label}: quotation has no printed date: {file}")
        elif po_date and when > po_date:
            errors.append(f"{label}: quotation dated after its PO ({po_date}): {file} {when}")
    for sib in quote.get("sibling_files") or []:
        if not isinstance(sib, dict) or sib.get("relation") not in SIBLING_RELATIONS:
            errors.append(f"{label}: sibling entry needs a relation in {SIBLING_RELATIONS}: {sib}")
        elif missing(root, sib["path"]):
            errors.append(f"{label}: sibling quotation file missing: {sib['path']}")
    return errors


def check_pos(pos: list[Doc], root: Path | None) -> list[str]:
    errors: list[str] = []
    seen: set[str] = set()
    numbers: set[tuple[str, str]] = set()
    by_quote: dict[str, list[Doc]] = defaultdict(list)
    for po in pos:
        label = f"PO {po['id']}"
        if po["id"] in seen:
            errors.append(f"duplicate PO id {po['id']}")
        seen.add(po["id"])
        if po.get("client_po_number"):
            key = (po["client"], po["client_po_number"])
            if key in numbers:
                errors.append(f"{label}: duplicate client PO number")
            numbers.add(key)
        elif not po.get("client_po_number_missing_reason"):
            errors.append(f"{label}: no client PO number and no reason")
        if not po.get("po_date"):
            errors.append(f"{label}: no PO date")
        if po.get("po_date_source") not in PO_DATE_SOURCES:
            errors.append(f"{label}: po_date_source must be one of {PO_DATE_SOURCES}")
        errors += check_amounts(po, label)
        errors += check_quotation(po, label, root)
        if po.get("quotation"):
            by_quote[po["quotation"]["file"]].append(po)
        for src in po.get("source_files") or []:
            if missing(root, src["path"]):
                errors.append(f"{label}: source file missing: {src['path']}")
        if not po.get("source_files"):
            errors.append(f"{label}: no source file")
    for file, group in by_quote.items():
        kinds = {p.get("link", {}).get("kind") for p in group}
        if len(group) > 1 and kinds != {"split"}:
            errors.append(f"quotation {file} serves {len(group)} POs without split marks")
        if len(group) == 1 and kinds == {"split"}:
            errors.append(f"PO {group[0]['id']}: split mark but only one PO uses {file}")
    return errors


def net(doc: Doc) -> Decimal:
    """Amount before tax: lines less discount plus charges."""
    charges = sum((dec(c["amount"]) for c in doc.get("charges") or []), Decimal(0))
    return dec(doc["subtotal"]) - dec(doc["discount"]) + charges


def check_invoices(invoices: list[Doc], pos: list[Doc], root: Path | None) -> list[str]:
    errors: list[str] = []
    po_by_id = {po["id"]: po for po in pos}
    seen: set[str] = set()
    for inv in invoices:
        label = f"invoice {inv['invoice_number']}"
        if inv["invoice_number"] in seen:
            errors.append(f"duplicate invoice number {inv['invoice_number']}")
        seen.add(inv["invoice_number"])
        errors += check_amounts(inv, label)
        if inv["due_date"] < inv["invoice_date"]:
            errors.append(f"{label}: due date {inv['due_date']} before invoice date")
        if inv.get("do_date") and inv["invoice_date"] < inv["do_date"]:
            errors.append(f"{label}: dated before its DO ({inv['do_date']})")
        po = po_by_id.get(inv["po_id"])
        if po is None:
            errors.append(f"{label}: unknown PO {inv['po_id']}")
        else:
            if po["client"] != inv["client"]:
                errors.append(f"{label}: client {inv['client']} != PO client {po['client']}")
            if po.get("po_date") and inv["invoice_date"] < po["po_date"]:
                errors.append(f"{label}: dated before its PO ({po['po_date']})")
            printed = printed_po_number(inv)
            if printed is not None and printed != po.get("client_po_number"):
                errors.append(
                    f"{label}: prints PO {printed}, but its PO is {po.get('client_po_number')}"
                )
            if net(po) != net(inv) and not inv.get("po_difference"):
                errors.append(
                    f"{label}: net amount {net(inv)} differs from its PO {net(po)} "
                    "without po_difference"
                )
        files = [inv["source_file"], *(inv.get("companion_files") or [])]
        if inv.get("do_source_file"):
            files.append(inv["do_source_file"])
        files += [d["source_file"] for d in inv.get("extra_dos") or []]
        errors += [f"{label}: source file missing: {rel}" for rel in files if missing(root, rel)]
    return errors


def printed_po_number(inv: Doc) -> str | None:
    """The PO number the invoice prints, after any recorded correction."""
    fixes = [c for c in inv.get("corrections") or [] if c["field"] == "po_number"]
    return fixes[-1]["value"] if fixes else inv.get("po_number_printed")


def validate(pos_doc: Doc, inv_doc: Doc, root: Path | None) -> list[str]:
    """Every error found; an empty list means the pair is consistent."""
    pos = pos_doc["pos"]
    invoices = inv_doc["invoices"]
    errors = check_pos(pos, root) + check_invoices(invoices, pos, root)
    if root is not None:
        for doc in (pos_doc, inv_doc):
            for drop in doc.get("dropped") or []:
                if not (root / drop["file"]).is_file():
                    errors.append(f"dropped file missing: {drop['file']}")
    return errors


def load(path: Path) -> Doc:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh, parse_float=Decimal)


def main(argv: list[str]) -> int:
    root = None if "--no-files" in argv else data_dir()
    if root is not None and not root.is_dir():
        print(f"GNS_DATA_DIR {root} not found; file checks skipped")
        root = None
    pos_doc, inv_doc = load(POS_FILE), load(INVOICES_FILE)
    errors = validate(pos_doc, inv_doc, root)
    for e in errors:
        print(e)
    print(f"{len(pos_doc['pos'])} POs, {len(inv_doc['invoices'])} invoices, {len(errors)} error(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
