"""Synthetic tests for the PO and invoice builders (no source files)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal as D
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

import build_docs
from build_docs import (
    attach_quotation,
    build_invoice,
    dump,
    invoice_only_po,
    manual_po,
    only_po,
    quote_evidence,
    review_csv,
)
from docs_extract import Buyer, InvoiceDoc, InvoiceLine, Quote, QuoteRow

Doc = dict[str, Any]


@pytest.fixture(autouse=True)
def manifest(monkeypatch: pytest.MonkeyPatch) -> None:
    """A stand-in for local/docs_manifest.py."""
    monkeypatch.setattr(
        build_docs,
        "m",
        SimpleNamespace(
            CLIENTS={"alpha": "PT. Alpha", "beta": "PT. Beta"},
            INV="Invoice",
            PRINTED_PO_VARIANTS={"PO-1 typo": ("PO-1", "Printed with a typo.")},
        ),
    )


def invoice(**kw: object) -> InvoiceDoc:
    base: Doc = {
        "invoice_numbers": ["901/INV"],
        "do_numbers": ["901/DO"],
        "invoice_date": date(2026, 3, 2),
        "due_date": None,
        "po_number": "PO-1",
        "po_date": None,
        "do_date": date(2026, 3, 1),
        "client": "PT ALPHA",
        "lines": [InvoiceLine(18, "Barang satu", D(2), "Pcs", D(1000), D(2000))],
        "subtotal": D(2000),
        "discount": D(100),
        "ppn": D(207),
        "total": D(2107),
        "ppn_rate": D(11),
        "buyer": Buyer("PT ALPHA", "Jl. Contoh 1", None),
    }
    return InvoiceDoc(**(base | kw))


def test_a_transcribed_po_derives_its_net_dpp() -> None:
    po = manual_po(
        {
            "client": "alpha",
            "number": "PO-1",
            "po_date": "2026-03-01",
            "lines": [{"qty": 2, "unit_price": 1000, "amount": 2000}],
            "discount": 100,
            "untaxed": 300,
            "dpp_basis": "net",
            "ppn_rate": 11,
            "ppn": 176,
            "total": 1900,
            "transcription": "photo",
            "sources": [{"path": "PO/po.jpg"}],
        }
    )
    assert (po["id"], po["client"], po["subtotal"], po["dpp"]) == (
        "alpha:PO-1",
        "PT. Alpha",
        D(2000),
        D(1600),
    )
    assert po["lines"][0]["no"] == 1


def test_an_order_known_only_from_its_invoice_dates_itself_from_billing() -> None:
    spec = {"invoice": "Invoice/901.xlsx", "client": "alpha", "number": "PO-1"}
    po = invoice_only_po(spec, invoice())
    assert (po["po_date"], po["po_date_source"]) == ("2026-03-01", "billing_fallback")
    assert (po["dpp"], po["total"]) == (D(1900), D(2107))
    fixed = invoice_only_po(
        spec | {"corrections": [{"field": "po_date", "value": "2026-02-20", "reason": "r"}]},
        invoice(po_date=date(2025, 2, 20)),
    )
    assert (fixed["po_date"], fixed["corrections"][0]["printed"]) == ("2026-02-20", "2025-02-20")
    with pytest.raises(ValueError, match="only po_date"):
        invoice_only_po(spec | {"corrections": [{"field": "total"}]}, invoice())
    with pytest.raises(ValueError, match="number_missing_reason"):
        invoice_only_po(spec | {"number": None}, invoice())


def test_an_invoice_keeps_its_buyer_and_corrects_only_dates() -> None:
    po = {"id": "alpha:PO-1", "client": "PT. Alpha"}
    got = build_invoice(
        {"file": "901.xlsx", "year_typo": True, "due_derived": True},
        invoice(invoice_date=date(2025, 3, 2), po_number="PO-1 typo"),
        po,
        Path("."),
    )
    assert (got["invoice_date"], got["due_date"]) == ("2026-03-02", "2026-04-01")
    assert got["buyer"] == {"name": "PT ALPHA", "address": "Jl. Contoh 1", "npwp": None}
    assert [c["field"] for c in got["corrections"]] == ["invoice_date", "due_date", "po_number"]
    fixed = build_invoice(
        {"file": "901.xlsx", "corrections": [{"field": "due_date", "value": "2026-05-01", "reason": "r"}]},
        invoice(),
        po,
        Path("."),
    )  # fmt: skip
    assert fixed["due_date"] == "2026-05-01"
    with pytest.raises(ValueError, match="only dates"):
        build_invoice(
            {"file": "x", "corrections": [{"field": "total", "value": "1", "reason": "r"}]},
            invoice(),
            po,
            Path("."),
        )
    with pytest.raises(ValueError, match="no invoice date"):
        build_invoice({"file": "x"}, invoice(invoice_date=None), po, Path("."))


def test_an_invoice_names_one_po() -> None:
    a = {"client": "PT. Alpha", "id": "a"}
    b = {"client": "PT. Beta", "id": "b"}
    assert only_po({"file": "x", "client": "beta"}, "PO-1", [a, b]) is b
    with pytest.raises(ValueError, match="2 POs"):
        only_po({"file": "x"}, "PO-1", [a, b])


def _quote(*rows: QuoteRow, number: str = "Q-1/GNS/III/2026") -> Quote:
    return Quote("DATA ENTRI", number, date(2026, 2, 1), list(rows), price_column=True)


def test_each_po_line_finds_its_quoted_row_by_price(monkeypatch: pytest.MonkeyPatch) -> None:
    quotes = {
        "q.xlsx": _quote(
            QuoteRow(15, D(2), "Barang satu", D(1000), []),
            QuoteRow(16, D(1), "Barang dua", D(500), []),
            QuoteRow(17, D(1), "Ongkir", D(300), []),
            QuoteRow(18, D(1), "Tidak dipesan", D(700), []),
        )
    }
    monkeypatch.setattr(build_docs, "read_quote_file", lambda p: quotes[p.name])
    po: Doc = {
        "po_date": "2026-03-01",
        "lines": [
            {"no": 1, "qty": 2, "unit_price": 1000},
            {"no": 2, "qty": 3, "unit_price": 500},
            {"no": 3, "qty": 1, "unit_price": 0},
            {"no": 4, "qty": 1, "unit_price": 999},
        ],
        "charges": [{"label": "Freight", "amount": 300}],
    }
    spec = {"quotation": {"file": "q.xlsx", "evidence": "price match"}}
    got = attach_quotation(po, spec, Path("."))["quotation"]
    assert [ln["status"] for ln in got["lines"]] == [
        "same",
        "qty_differs",
        "unpriced",
        "not_in_quotation",
    ]
    assert got["charges"] == [{"charge": "Freight", "quote_row": 17}]
    assert (got["match"], got["unordered_quote_rows"]) == ("differs", [18])
    assert po["link"] == {"kind": "single"}
    exact = quote_evidence(
        {"lines": [{"no": 1, "qty": 2, "unit_price": 1000}], "charges": []},
        {"file": "q.xlsx", "evidence": "e", "rows": {1: 15}},
        Path("."),
    )
    assert (exact["match"], exact["lines"][0]["quote_row"]) == ("subset", 15)


def test_a_rebuilt_quotation_is_dated_on_the_order() -> None:
    po: Doc = {"po_date": "2026-03-01"}
    attach_quotation(po, {"synthetic_quotation": {"reason": "r"}}, Path("."))
    assert po["synthetic_quotation"] == {"date": "2026-03-01", "reason": "r"}
    assert po["link"] == {"kind": "synthetic"}


def test_the_review_sheet_lists_each_po_with_its_flags() -> None:
    pos = {
        "pos": [
            {
                "id": "alpha:PO-1",
                "po_date": "2026-03-01",
                "po_date_source": "billing_fallback",
                "source_kind": "invoice_only",
                "link": {"kind": "synthetic"},
                "quotation": None,
                "quotation_missing_reason": "none in the files",
                "client_po_number": None,
                "synthetic_quotation": {"overwritten_file": {"path": "q.xlsx"}},
                "total": D("2107.00"),
            }
        ]
    }
    invs = {"invoices": [{"po_id": "alpha:PO-1", "invoice_number": "901/INV"}]}
    rows = review_csv(pos, invs).splitlines()
    assert rows[1].endswith(
        "none in the files,,901/INV,2107,po_date:billing_fallback no_po_number "
        "quotation_workbook_overwritten"
    )
    assert dump({"a": D("1.50"), "b": [2.0]}) == '{\n  "a": 1.5,\n  "b": [\n    2\n  ]\n}\n'
