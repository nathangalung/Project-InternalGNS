"""Unit tests for the curated PO and invoice validator."""

import copy
from pathlib import Path
from typing import Any

import pytest

from validate_docs import validate

Doc = dict[str, Any]

QUOTE = "Quotation/Quotation 2026 - Excel/Q-1 (Relay).xlsx"


def _po(**over: object) -> Doc:
    po: Doc = {
        "id": "kas-sentosa:JKT-PO/1",
        "client": "PT. Karunia Aman Sentosa",
        "client_po_number": "JKT-PO/1",
        "po_date": "2026-01-13",
        "po_date_source": "document",
        "lines": [
            {
                "no": 1,
                "description": "Relay",
                "qty": 3,
                "unit": "Pcs",
                "unit_price": 135000,
                "amount": 405000,
            },
            {
                "no": 2,
                "description": "Socket",
                "qty": 2,
                "unit": "Pcs",
                "unit_price": 0.5,
                "amount": 1,
            },
        ],
        "charges": [],
        "subtotal": 405001,
        "discount": 0,
        "dpp": 405001,
        "dpp_basis": "net",
        "untaxed": 0,
        "ppn_rate": 11,
        "ppn": 44550.11,
        "total": 449551.11,
        "source_kind": "po_file",
        "source_files": [{"path": "PO/a.pdf"}],
        "quotation": {"file": QUOTE, "printed_date": "2026-01-10"},
        "quotation_missing_reason": None,
        "synthetic_quotation": None,
        "link": {"kind": "single"},
    }
    po.update(over)
    return po


def _inv(**over: object) -> Doc:
    inv: Doc = {
        "invoice_number": "916/INV-GNS/I/2026",
        "invoice_date": "2026-01-26",
        "due_date": "2026-02-25",
        "po_id": "kas-sentosa:JKT-PO/1",
        "client": "PT. Karunia Aman Sentosa",
        "lines": copy.deepcopy(_po()["lines"]),
        "subtotal": 405001,
        "discount": 0,
        "dpp": 405001,
        "dpp_basis": "net",
        "untaxed": 0,
        "ppn_rate": 11,
        "ppn": 44550.11,
        "total": 449551.11,
        "do_number": "916/DO-GNS/I/2026",
        "do_date": "2026-01-26",
        "po_number_printed": "JKT-PO/1",
        "corrections": [],
        "source_file": "Invoice/a.xlsx",
    }
    inv.update(over)
    return inv


def _run(pos: list[Doc], invs: list[Doc], data_dir: Path | None = None) -> list[str]:
    return validate({"pos": pos}, {"invoices": invs}, data_dir)


def test_valid_pair_passes() -> None:
    assert _run([_po()], [_inv()]) == []


@pytest.mark.parametrize(
    ("po_over", "needle"),
    [
        ({"subtotal": 405000}, "subtotal"),
        ({"ppn": 44550}, "PPN"),
        ({"total": 449550}, "total"),
        ({"dpp": 405000}, "DPP"),
        ({"quotation": None}, "quotation"),
    ],
)
def test_po_arithmetic_and_links(po_over: Doc, needle: str) -> None:
    errors = _run([_po(**po_over)], [_inv()])
    assert any(needle in e for e in errors), errors


def test_line_amount_must_equal_qty_times_price() -> None:
    po = _po()
    po["lines"][0]["amount"] = 405100
    assert any("line 1" in e for e in _run([po], [_inv()]))


def test_untaxed_freight_and_nilai_lain() -> None:
    sml = _po(
        lines=[
            {"no": 1, "description": "O-ring", "qty": 1, "unit_price": 1800000, "amount": 1800000},
            {"no": 2, "description": "Freight", "qty": 1, "unit_price": 1200000, "amount": 1200000},
        ],
        subtotal=3000000,
        discount=90000,
        untaxed=1200000,
        dpp=1710000,
        ppn=188100,
        total=3098100,
    )
    imc = _po(
        id="imc:8404",
        client="PT. IMC Ship Management",
        client_po_number="8404",
        lines=[
            {"no": 1, "description": "PUMA", "qty": 1, "unit_price": 30000000, "amount": 30000000}
        ],
        subtotal=30000000,
        dpp_basis="nilai_lain",
        dpp=27500000,
        ppn_rate=12,
        ppn=3300000,
        total=33300000,
        quotation={"file": "Quotation/q2.xlsx", "printed_date": "2026-01-10"},
    )
    excluded = _po(
        id="niterra:ID-1",
        client="PT. Niterra Mobility Indonesia",
        client_po_number="ID-1",
        lines=[
            {
                "no": 1,
                "description": "Seal",
                "qty": 10,
                "unit_price": 514000,
                "amount": 5140000,
                "discount": 257000,
            }
        ],
        subtotal=5140000,
        discount=257000,
        dpp_basis="none",
        dpp=None,
        ppn_rate=None,
        ppn=None,
        total=4883000,
        quotation={"file": "Quotation/q3.xlsx", "printed_date": "2026-01-10"},
    )
    assert _run([sml, imc, excluded], []) == []
    excluded["discount"] = 250000
    excluded["total"] = 4890000
    assert any("line discounts" in e for e in _run([excluded], []))


def test_invoice_must_point_at_a_known_po_of_the_same_client() -> None:
    assert any("unknown PO" in e for e in _run([_po()], [_inv(po_id="nope")]))
    assert any("client" in e for e in _run([_po()], [_inv(client="PT. Other")]))


def test_invoice_differing_from_po_needs_a_note() -> None:
    inv = _inv(
        lines=[{"no": 1, "description": "Relay", "qty": 3, "unit_price": 135000, "amount": 405000}],
        subtotal=405000,
        dpp=405000,
        ppn=44550,
        total=449550,
    )
    assert any("differs from its PO" in e for e in _run([_po()], [inv]))
    inv["po_difference"] = "Only the relay was delivered."
    assert _run([_po()], [inv]) == []


def test_dates_and_duplicates() -> None:
    assert any("due date" in e for e in _run([_po()], [_inv(due_date="2026-01-01")]))
    assert any("before its PO" in e for e in _run([_po()], [_inv(invoice_date="2026-01-01")]))
    assert any("duplicate invoice" in e for e in _run([_po()], [_inv(), _inv()]))
    assert any("duplicate PO id" in e for e in _run([_po(), _po()], []))


def test_shared_quotation_needs_split_marks() -> None:
    a = _po()
    b = _po(id="kas-selalu:JKT-PO/2", client="PT. Karunia Aman Selalu", client_po_number="JKT-PO/2")
    assert any("split" in e for e in _run([a, b], []))
    a["link"] = {"kind": "split", "group": "Q-1"}
    b["link"] = {"kind": "split", "group": "Q-1"}
    assert _run([a, b], []) == []
    assert any("only one PO" in e for e in _run([a], []))


SYNTHETIC: Doc = {
    "date": "2026-01-13",
    "lines_from": "po",
    "reason": "No quotation in Data predates the order.",
}


def test_missing_quotation_needs_reason_and_synthetic_spec() -> None:
    po = _po(quotation=None, quotation_missing_reason="No quotation in Data.")
    assert any("synthetic" in e for e in _run([po], []))
    po["synthetic_quotation"] = SYNTHETIC
    assert any("link kind" in e for e in _run([po], []))
    po["link"] = {"kind": "synthetic"}
    assert _run([po], []) == []
    po["quotation_missing_reason"] = None
    assert any("no reason" in e for e in _run([po], []))


def test_overwritten_workbook_must_exist(tmp_path: Path) -> None:
    _touch(tmp_path, "PO/a.pdf")
    po = _po(
        quotation=None,
        quotation_missing_reason="Workbook overwritten.",
        synthetic_quotation={**SYNTHETIC, "overwritten_file": {"path": "Quotation/old.xlsx"}},
        link={"kind": "synthetic"},
    )
    assert any("Quotation/old.xlsx" in e for e in _run([po], [], tmp_path))
    _touch(tmp_path, "Quotation/old.xlsx")
    assert _run([po], [], tmp_path) == []


def test_synthetic_quotation_must_not_postdate_the_po() -> None:
    po = _po(
        quotation=None,
        quotation_missing_reason="No quotation in Data.",
        synthetic_quotation={**SYNTHETIC, "date": "2026-01-14"},
        link={"kind": "synthetic"},
    )
    assert any("synthetic quotation dated after" in e for e in _run([po], []))


def test_quotation_must_be_dated_on_or_before_the_po() -> None:
    late = _po(quotation={"file": QUOTE, "printed_date": "2026-01-14"})
    assert any("quotation dated after its PO" in e for e in _run([late], []))
    undated = _po(quotation={"file": QUOTE, "printed_date": None})
    assert any("quotation has no printed date" in e for e in _run([undated], []))
    other = _po(
        quotation={
            "file": QUOTE,
            "printed_date": "2026-01-10",
            "other_files": [
                {
                    "file": "Quotation/q9.xlsx",
                    "printed_number": "Q-9",
                    "printed_date": "2026-02-01",
                }
            ],
        }
    )
    errors = _run([other], [])
    assert any("dated after its PO" in e and "q9.xlsx" in e for e in errors), errors


def test_po_needs_a_date_and_a_number_or_a_reason() -> None:
    assert any("no PO date" in e for e in _run([_po(po_date=None)], []))
    assert any("po_date_source" in e for e in _run([_po(po_date_source="guess")], []))
    nameless = _po(client_po_number=None)
    assert any("no client PO number" in e for e in _run([nameless], []))
    nameless["client_po_number_missing_reason"] = "PO Ref left blank on the invoice."
    assert _run([nameless], []) == []


def test_invoice_not_before_its_do() -> None:
    errors = _run([_po()], [_inv(do_date="2026-01-27")])
    assert any("dated before its DO" in e for e in errors)


def test_printed_po_number_must_name_the_po() -> None:
    wrong = _inv(po_number_printed="JKT-PO/2")
    assert any("prints PO JKT-PO/2" in e for e in _run([_po()], [wrong]))
    wrong["corrections"] = [
        {
            "field": "po_number",
            "printed": "JKT-PO/2",
            "value": "JKT-PO/1",
            "reason": "Typo.",
        }
    ]
    assert _run([_po()], [wrong]) == []
    assert _run([_po()], [_inv(po_number_printed=None)]) == []


def _touch(root: Path, *rels: str) -> None:
    for rel in rels:
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_bytes(b"x")


def test_files_must_exist_when_data_dir_given(tmp_path: Path) -> None:
    errors = _run([_po()], [_inv()], tmp_path)
    assert any("quotation file" in e for e in errors)
    assert any("source file" in e for e in errors)
    _touch(tmp_path, QUOTE, "PO/a.pdf", "Invoice/a.xlsx")
    assert _run([_po()], [_inv()], tmp_path) == []


def test_related_files_must_exist(tmp_path: Path) -> None:
    _touch(tmp_path, QUOTE, "PO/a.pdf", "Invoice/a.xlsx")
    po = _po(
        quotation={
            "file": QUOTE,
            "printed_date": "2026-01-10",
            "other_files": [
                {
                    "file": "Quotation/o.xlsx",
                    "printed_number": "Q-2",
                    "printed_date": "2026-01-01",
                }
            ],
            "sibling_files": [{"path": "Quotation/copy (1).xlsx", "relation": "copy"}],
        }
    )
    inv = _inv(
        do_source_file="Invoice/do.xlsx",
        extra_dos=[
            {
                "number": "916B/DO-GNS/I/2026",
                "date": "2026-01-26",
                "source_file": "Invoice/b.xlsx",
            }
        ],
    )
    errors = _run([po], [inv], tmp_path)
    for needle in ("Quotation/o.xlsx", "copy (1)", "Invoice/do.xlsx", "Invoice/b.xlsx"):
        assert any(needle in e for e in errors), needle
    _touch(
        tmp_path,
        "Quotation/o.xlsx",
        "Quotation/copy (1).xlsx",
        "Invoice/do.xlsx",
        "Invoice/b.xlsx",
    )
    assert _run([po], [inv], tmp_path) == []


def test_sibling_entries_name_their_relation() -> None:
    po = _po(
        quotation={
            "file": QUOTE,
            "printed_date": "2026-01-10",
            "sibling_files": [{"path": "Quotation/x.xlsx", "relation": "sibling"}],
        }
    )
    assert any("relation" in e for e in _run([po], []))
    po["quotation"]["sibling_files"] = ["Quotation/x.xlsx"]
    assert any("relation" in e for e in _run([po], []))
