"""Synthetic tests for reading issued quotation PDFs and applying them."""

from __future__ import annotations

import copy
from pathlib import Path
from typing import Any

import pytest

import issued
from issued import _overwritten_header, _rechain, apply_issued_pdfs, pdf_version, take_pdf
from pdf_quote import parse_pdf_quote, trusted

PDF = """\
                                           PT. CONTOH NIAGA
To           : PT. Contoh Bahari                     No.                 :          Q-100002/GNS/V/2025
Attn         : Ibu Contoh Satu                       Your Ref no.        :          RFQ-77
Email        : satu@contoh.invalid                   Date                :          Jakarta, 07 May 2025
                                                     QUOTATION
No. Qty Unit                  DESCRIPTION                         Unit Price                     Amount
  1      3     Pcs Seal shaft 38mm                               Rp        500.000 Rp                1.500.000
                   rubber
  2      2     Pcs V ring                                        Rp         50.000 Rp                  100.000
       4     pcs Coupling 1-1/2 inch                             Rp         25.000 Rp                  100.000
  4      1     set Pump spare (not offered)                      No quote          Rp                        -
                                                                 Total                   Rp        1.700.000
                                                                 Diskon 10%              Rp          170.000
                                                                 Sub Total               Rp        1.530.000
                                                                 PPN 12%                 Rp          168.300
                                                                 Grand Total             Rp        1.698.300
"""


def test_reads_header_rows_and_totals() -> None:
    q = parse_pdf_quote(PDF)
    assert (q.number, q.your_ref, q.attn, q.email) == (
        "Q-100002/GNS/V/2025",
        "RFQ-77",
        "Ibu Contoh Satu",
        "satu@contoh.invalid",
    )
    assert q.date is not None and q.date.isoformat() == "2025-05-07"
    assert [(ln.no, ln.qty, ln.unit, ln.price, ln.amount) for ln in q.lines] == [
        (1, 3.0, "PCS", 500_000, 1_500_000),
        (2, 2.0, "PCS", 50_000, 100_000),
        (3, 4.0, "PCS", 25_000, 100_000),
        (4, 1.0, "SET", 0.0, 0.0),
    ]
    assert q.lines[2].request == "Coupling 1-1/2 inch"  # its number was lost in the text
    assert not q.lines[3].available
    assert (q.items_total, q.discount, q.grand) == (1_700_000, 170_000, 1_698_300)
    assert trusted(q, 1_698_300)


def test_a_table_that_does_not_add_up_is_not_trusted() -> None:
    q = parse_pdf_quote(PDF.replace("1.500.000", "1.400.000"))
    assert not trusted(q, 1_698_300)
    assert not trusted(parse_pdf_quote(PDF), 1_000_000)  # another PDF's grand total


def _line(request: str, sell: float, cost: float, row: int) -> dict[str, Any]:
    return {
        "row": row,
        "no_raw": str(row),
        "qty": 2.0,
        "qty_raw": 2.0,
        "unit_raw": "Pcs",
        "unit": "PCS",
        "unit_mapped": True,
        "request": request,
        "offer": None,
        "offer_note": None,
        "available": True,
        "impa": None,
        "impa_raw": None,
        "impa_problem": None,
        "impa_in_text": [],
        "sell": sell,
        "sell_printed": sell,
        "cost": cost,
        "line_total": 2 * sell,
        "in_total": True,
        "nama_asli": None,
        "vendor": "Toko Satu",
        "channel": None,
        "flags": [],
    }


def _record() -> dict[str, Any]:
    return {
        "id": "Quotation 2025/Q-100002 (Seal).xlsx#DATA ENTRI",
        "year": 2025,
        "date": "2025-06-12",
        "date_source": "data",
        "number": {
            "original": "Q-100009/GNS/VI/2025",
            "print": "Q-100009/GNS/VI/2025",
            "sheet": None,
            "file": "Q-100002",
            "pdf": "Q-100002/GNS/V/2025",
        },
        "client": {"name": "PT. Contoh Bahari"},
        "contact": {"name": "Ibu Lain", "email": "lain@contoh.invalid", "phone": None},
        "client_ref": "REF-OTHER",
        "client_ref_source": "print",
        "discount": {"kind": "pct", "pct": 7.0, "amount": 0.0, "label": "Diskon 7%"},
        "lines": [
            _line("Seal shaft 38mm", 500_000, 300_000, 15),
            _line("V ring", 50_000, 20_000, 16),
        ],
        "computed_totals": {"ppn_rate": 12.0, "dpp": 1.0},
        "print_totals": {"grand": 1_000_000},
        "pdf": {"path": "x.pdf", "number": "Q-100002/GNS/V/2025", "grand": 1_698_300},
        "revision": None,
        "flags": [],
    }


def test_an_overwritten_header_is_recognised() -> None:
    rec = _record()
    assert _overwritten_header(rec)
    rec["number"]["pdf"] = rec["number"]["original"]
    assert not _overwritten_header(rec)


def test_pdf_lines_replace_the_workbook_and_keep_its_costs() -> None:
    rec = _record()
    take_pdf(rec, parse_pdf_quote(PDF))
    assert rec["number"]["original"] == "Q-100002/GNS/V/2025"
    assert (rec["date"], rec["client_ref"]) == ("2025-05-07", "RFQ-77")
    assert rec["contact"]["name"] == "Ibu Contoh Satu"
    assert rec["discount"]["kind"] == "pct" and rec["discount"]["pct"] == 10.0
    seal, ring, coupling, pump = rec["lines"]
    assert (seal["qty"], seal["cost"], seal["vendor"], seal["row"]) == (
        3.0,
        300_000,
        "Toko Satu",
        15,
    )
    assert (ring["cost"], coupling["cost"], coupling["row"]) == (20_000, None, None)
    assert "line_from_pdf" in coupling["flags"]
    assert not pump["available"] and pump["sell"] == 0
    assert round(rec["computed_totals"]["gross"]) == 1_700_000
    assert "lines_from_pdf" in rec["flags"]


def test_a_pdf_only_version_joins_the_chain_by_date(tmp_path: Path) -> None:
    base = _record()
    base["number"]["original"] = "Q-100002/GNS/V/2025"
    version = pdf_version(
        base, {"path": "Q-100002.pdf", "number": "Q-100002/GNS/V/2025"}, parse_pdf_quote(PDF)
    )
    assert version["source"]["kind"] == "pdf" and "pdf_only_version" in version["flags"]
    chain = [base, version]
    _rechain(chain, tmp_path)
    assert [r["id"] for r in chain] == ["Q-100002.pdf", base["id"]]
    assert [r["revision"]["index"] for r in chain] == [0, 1]
    assert {r["revision"]["base_id"] for r in chain} == {"Q-100002.pdf"}
    untouched = copy.deepcopy(base["lines"])
    assert base["lines"] == untouched


def test_issued_pdfs_are_applied_and_unreadable_ones_listed(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(issued, "pdf_text", lambda p: PDF if p.name.startswith("good") else "")
    edited = _record()
    edited["pdf"]["path"] = "good.pdf"
    edited["reconciliation"] = [{"cause": "workbook_changed_after_pdf"}]
    unread = _record()
    unread["id"] = "b.xlsx#S"
    unread["number"]["pdf"] = unread["number"]["original"]
    unread["pdf"] = {"path": "bad.pdf", "number": "Q-100009/GNS/VI/2025", "grand": 5.0}
    unread["reconciliation"] = [{"cause": "workbook_changed_after_pdf"}]
    kept = [edited, unread]
    unmatched = [
        {"path": "good copy.pdf", "number": "Q-100002/GNS/V/2025", "grand": 1_698_300,
         "status": "no workbook"},
        {"path": "bad.pdf", "number": "Q-100003/GNS/V/2025", "grand": 1.0,
         "status": "no workbook"},
    ]  # fmt: skip
    missing = apply_issued_pdfs(kept, unmatched, tmp_path)
    assert {"header_from_pdf", "lines_from_pdf"} <= set(edited["flags"])
    assert "pdf_lines_unread" in unread["flags"]
    assert [(u["path"], u["why"]) for u in missing] == [
        ("bad.pdf", "edited after"),
        ("bad.pdf", "version"),
    ]
    assert unmatched[0]["status"] == "already imported"
