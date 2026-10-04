"""Synthetic tests for the printed buyer block and DO-sheet units."""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path

from openpyxl import Workbook

from build_docs import units_from_do
from docs_extract import InvoiceDoc, InvoiceLine, buyer_block, read_do_units


def _sheet(cells: dict[str, object]) -> Workbook:
    wb = Workbook()
    ws = wb.active
    for coord, value in cells.items():
        ws[coord] = value
    return wb


def test_buyer_block_reads_name_and_address_up_to_the_phone() -> None:
    ws = _sheet(
        {
            "E11": "PT CONTOH BAHARI",
            "E12": "Gedung Contoh Lt.2,",
            "E13": "Jl. Contoh No. 1",
            "E14": "021 1234567 / 021 7654321",
            "E15": "ignored",
        }
    ).active
    buyer = buyer_block(ws)
    assert buyer is not None
    assert (buyer.name, buyer.address, buyer.npwp) == (
        "PT CONTOH BAHARI",
        "Gedung Contoh Lt.2, Jl. Contoh No. 1",
        None,
    )


def test_buyer_block_keeps_the_first_company_and_a_printed_npwp() -> None:
    ws = _sheet(
        {
            "D9": "PT SATU CONTOH\nPT DUA CONTOH",
            "D10": "Jl. Contoh Raya 5",
            "D11": "NPWP : 01.234.567.8-901.000",
            "D12": "Bp. Contoh 081234567890",
        }
    ).active
    buyer = buyer_block(ws)
    assert buyer is not None
    assert (buyer.name, buyer.address, buyer.npwp) == (
        "PT SATU CONTOH",
        "Jl. Contoh Raya 5",
        "012345678901000",
    )


def test_buyer_block_ignores_the_seller() -> None:
    assert buyer_block(_sheet({"A1": "PT. GLOBAL NIAGA SAKTI"}).active) is None


def test_units_come_from_the_do_sheet_when_the_invoice_has_none(tmp_path: Path) -> None:
    wb = _sheet({"B16": 1, "C16": 6, "D16": "Pcs", "E16": "Relay contoh"})
    wb.active.title = "DO"
    path = tmp_path / "do.xlsx"
    wb.save(path)
    assert read_do_units(path) == ["Pcs"]
    line = InvoiceLine(18, "Relay contoh", Decimal(6), None, Decimal(1000), Decimal(6000))
    inv = InvoiceDoc(
        ["1/INV"], ["1/DO"], None, None, None, None, None, None, [line],
        Decimal(6000), Decimal(0), Decimal(0), Decimal(6000), Decimal(0),
    )  # fmt: skip
    units_from_do(inv, read_do_units(path))
    assert inv.lines[0].unit == "Pcs"
    units_from_do(inv, ["Set", "Pcs"])  # another count: left alone
    assert inv.lines[0].unit == "Pcs"
