"""Unit tests for PDF matching and totals reconciliation."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from reconcile import (
    attach_pdfs,
    classify_unmatched,
    compare_print_oracle,
    compare_totals,
    content_in_pdf,
    load_pdf_index,
    parse_rupiah,
    pdf_grand_from_text,
)

Record = dict[str, Any]


def test_parse_rupiah() -> None:
    assert parse_rupiah(" Grand Total Rp 345.678.900") == 345678900
    assert parse_rupiah(" GRAND TOTAL Rp. 35.100.000") == 35100000
    assert parse_rupiah(" Grand Total Rp -") == 0
    assert parse_rupiah("") is None


def test_pdf_grand_from_text() -> None:
    text = (
        " 1.   2  pcs Floatless Level Switch     Rp.  2.240.000 Rp.   4.480.000\n"
        "                          Sub Total : Rp.         1.860.000\n"
        "                           Disk 5%    Rp.          (93.000)\n"
        "                           PPN 11%    Rp.          194.370\n"
        "                           TOTAL      Rp.        1.961.370\n"
    )
    assert pdf_grand_from_text(text) == 1961370
    assert pdf_grand_from_text("   Total  Rp 10\n   Grand Total  Rp 12\n") == 12
    assert pdf_grand_from_text("no totals here") is None


def test_load_pdf_index(tmp_path: Path) -> None:
    tsv = tmp_path / "pdf.tsv"
    tsv.write_text(
        "./Quotation 2024/Q-509 (No. 19).pdf\tQ-509/GNS/VII/2024\tJakarta, 26 Juli 2024\t5\t"
        " Grand Total Rp 345.678.900\n"
        "./Quotation 2024/Q-447 (Valve).pdf\tQ-447/GNS/VI/2024\t\t1\t\n",
        encoding="utf-8",
    )
    pdfs = load_pdf_index(tsv)
    assert pdfs[0] == {
        "path": "Quotation 2024/Q-509 (No. 19).pdf",
        "number": "Q-509/GNS/VII/2024",
        "date": "2024-07-26",
        "pages": 5,
        "grand": 345678900,
    }
    assert pdfs[1]["date"] is None and pdfs[1]["grand"] is None


def _rec(path: str, number: str, when: str, grand: float) -> Record:
    return {
        "id": path + "#DATA ENTRI",
        "source": {"files": [path]},
        "number": {"original": number, "print": number, "pdf": None},
        "file_name": {"number": number.split("/")[0]},
        "date": when,
        "print_totals": {"grand": grand},
        "pdf": None,
        "flags": [],
    }


def test_attach_pdfs_lets_the_proven_pdf_win() -> None:
    rec = _rec(
        "Q-523 (DEWI AMBARWATI) - pelita.xlsx", "Q-523/GNS/VIII/2024", "2024-08-05", 30876543.7
    )
    pdfs = [
        {"path": "Quotation 2024/Q-523 (V-94-306) - Pelita.pdf", "number": "Q-523/GNS/VIII/2024",
         "date": "2024-08-05", "pages": 1, "grand": 25987654},
        {"path": "Quotation 2024/Q-530 (V-94-309) - Pelita.pdf", "number": "Q-523/GNS/VIII/2024",
         "date": "2024-08-05", "pages": 2, "grand": 30876544},
    ]  # fmt: skip
    unmatched = attach_pdfs([rec], pdfs)
    assert rec["pdf"]["grand"] == 30876544
    assert [p["grand"] for p in unmatched] == [25987654]


def test_attach_pdfs_by_number_and_date_then_grand_total() -> None:
    base = _rec("Q-956216 (R7707) - IMC.xlsx", "Q-956216/GNS/VII/2025", "2025-07-15", 12885185.3)
    export = _rec(
        "PDF/Q-956216 (R7707) - IMC.xlsx", "Q-956216/GNS/VII/2025", "2025-07-15", 13018435.25
    )
    other = _rec("Q-509 (No. 19) - Isna.xlsx", "Q-509/GNS/VII/2024", "2024-07-26", 345678900.3)
    pdfs = [
        {"path": "PDF/Q-956216 (R7707) - IMC.pdf", "number": "Q-956216/GNS/VII/2025",
         "date": "2025-07-15", "pages": 4, "grand": 13018435},
        {"path": "Quotation 2024/Q-509 (No. 19).pdf", "number": "Q-509/GNS/VII/2024",
         "date": "2024-07-26", "pages": 5, "grand": 345678900},
        {"path": "Quotation 2025/Q-956250 (V-95-257-E).pdf", "number": "Q-956250/GNS/VIII/2025",
         "date": "2025-08-04", "pages": 1, "grand": 1000},
    ]  # fmt: skip
    unmatched = attach_pdfs([base, export, other], pdfs)
    assert base["pdf"] is None
    assert export["pdf"]["path"] == "PDF/Q-956216 (R7707) - IMC.pdf"
    assert export["number"]["pdf"] == "Q-956216/GNS/VII/2025"
    assert other["pdf"]["grand"] == 345678900
    assert "pdf_number_ne_print" not in other["flags"]
    assert [p["path"] for p in unmatched] == ["Quotation 2025/Q-956250 (V-95-257-E).pdf"]


def test_attach_pdfs_flags_a_name_match_printing_another_number() -> None:
    rec = _rec("Q-700 (Seal SB) - NGK.xlsx", "Q-700/GNS/XII/2024", "2024-12-12", 2512346.4)
    pdf = {"path": "Quotation 2024/Q-700 (Seal SB) - NGK.xlsx.pdf", "number": "Q-654/GNS/XII/2024",
           "date": "2024-12-12", "pages": 1, "grand": 2512346}  # fmt: skip
    assert attach_pdfs([rec], [pdf]) == []
    assert rec["flags"] == ["pdf_matched_by_file_name", "pdf_number_ne_print"]


def _totals_rec(computed: Record, printed: Record | None, pdf: int | None = None) -> Record:
    return {
        "computed_totals": computed,
        "print_totals": printed,
        "pdf": {"grand": pdf} if pdf is not None else None,
        "flags": [],
    }


def test_compare_totals_clean() -> None:
    c = {"gross": 100.0, "discount": 5.0, "net": 95.0, "dpp": None, "ppn": 10.45, "grand": 105.45}
    p = {"gross": 100.0, "discount": 5.0, "net": None, "dpp": None, "ppn": 10.45, "grand": 105.45}
    assert compare_totals(_totals_rec(c, p, pdf=105)) == []


def test_compare_totals_template_grand_is_dpp_plus_ppn() -> None:
    c = {
        "gross": 32000000.0,
        "discount": 1600000.0,
        "net": 30400000.0,
        "dpp": 27866666.67,
        "ppn": 3344000.0,
        "grand": 33744000.0,
    }
    p = {"gross": 32000000.0, "discount": 1600000.0, "net": 30400000.0,
         "dpp": 27866666.67, "ppn": 3344000.0, "grand": 31210666.67}  # fmt: skip
    (m,) = compare_totals(_totals_rec(c, p))
    assert m["field"] == "grand" and m["source"] == "print"
    assert m["cause"] == "print_grand_is_dpp_plus_ppn"


def test_compare_totals_zero_print_and_uncached_print() -> None:
    c = {"gross": 100.0, "discount": 0.0, "net": 100.0, "dpp": None, "ppn": 11.0, "grand": 111.0}
    zero = {"gross": 0.0, "discount": 0.0, "net": 0.0, "dpp": None, "ppn": 0.0, "grand": 0.0}
    causes = {m["cause"] for m in compare_totals(_totals_rec(c, zero))}
    assert causes == {"print_totals_zero"}
    none = {"gross": None, "discount": None, "net": None, "dpp": None, "ppn": None, "grand": None}
    assert compare_totals(_totals_rec(c, none)) == []
    options = _totals_rec(c, zero)
    options["flags"] = ["print_price_list"]
    assert {m["cause"] for m in compare_totals(options)} == {"print_total_zero_price_list"}


def test_compare_totals_pdf_differs_from_print() -> None:
    c = {"gross": 100.0, "discount": 0.0, "net": 100.0, "dpp": None, "ppn": 11.0, "grand": 111.0}
    p = {"gross": 100.0, "discount": 0.0, "net": None, "dpp": None, "ppn": 11.0, "grand": 111.0}
    (m,) = compare_totals(_totals_rec(c, p, pdf=120))
    assert (m["field"], m["source"], m["cause"]) == ("grand", "pdf", "workbook_changed_after_pdf")


def test_compare_print_oracle() -> None:
    printed = {"discount": 34500.0, "ppn": 77460.0, "grand": 722960.0, "dpp": 591708.33}
    entry = {
        "path": "x.xlsx",
        "disc": ["Diskon 5%", 34500],
        "ppn": ["PPN 12%", 77460.0],
        "grand": ["Grand Total", 722800],
        "sub": ["Sub Total (1):", 1],
    }
    assert compare_print_oracle(printed, entry) == [
        {"field": "grand", "ours": 722960.0, "oracle": 722800, "label": "Grand Total"}
    ]
    assert compare_print_oracle(None, {"path": "x", "grand": ["Grand Total", 5]}) == [
        {"field": "grand", "ours": None, "oracle": 5, "label": "Grand Total"}
    ]


def test_compare_totals_names_the_print_lines_that_differ() -> None:
    c = {"gross": 250.0, "discount": 0.0, "net": 250.0, "dpp": None, "ppn": 0.0, "grand": 250.0}
    p = {"gross": 125.0, "discount": 0.0, "net": None, "dpp": None, "ppn": 0.0, "grand": 125.0}
    rec = _totals_rec(c, p)
    rec["print_line_diffs"] = [{"row": 16, "data_amount": 250.0, "print_amount": 125.0}]
    causes = {m["field"]: m["cause"] for m in compare_totals(rec)}
    assert causes == {"gross": "print_line_amounts_differ", "grand": "follows_gross_difference"}


def test_compare_totals_pdf_printed_as_zero() -> None:
    c = {"gross": 100.0, "discount": 0.0, "net": 100.0, "dpp": None, "ppn": 11.0, "grand": 111.0}
    (m,) = compare_totals(_totals_rec(c, None, pdf=0))
    assert (m["source"], m["cause"]) == ("pdf", "pdf_total_zero")


def test_attach_pdfs_tries_every_number_match_before_file_names() -> None:
    q654 = _rec("NGK/Q-654 (Seal SB) - NGK.xlsx", "Q-654/GNS/XII/2024", "2024-12-04", 0.0)
    q669 = _rec(
        "NGK/Q-669 (Seal SB - 5 pcs) - NGK.xlsx", "Q-669/GNS/XII/2024", "2024-12-12", 2512345.5
    )
    pdfs = [
        {"path": "Quotation 2024/Q-654 (Seal SB) - NGK.xlsx.pdf", "number": "Q-654/GNS/XII/2024",
         "date": "2024-12-04", "pages": 1, "grand": 0},
        {"path": "Quotation 2024/Q-669 (Seal SB - 5 pcs) - NGK.pdf",
         "number": "Q-654/GNS/XII/2024", "date": "2024-12-04", "pages": 1, "grand": 2512346},
        {"path": "Quotation 2024/Q-669 (Seal SB - 5 pcs) - NGK.xlsx.pdf",
         "number": "Q-669/GNS/XII/2024", "date": "2024-12-12", "pages": 1, "grand": 2512346},
    ]  # fmt: skip
    unmatched = attach_pdfs([q654, q669], pdfs)
    assert (q654["number"]["pdf"], q669["number"]["pdf"]) == (
        "Q-654/GNS/XII/2024",
        "Q-669/GNS/XII/2024",
    )
    assert q669["flags"] == []
    assert [p["path"] for p in unmatched] == ["Quotation 2024/Q-669 (Seal SB - 5 pcs) - NGK.pdf"]


_Q639_PDF = """
No. Qty Unit                DESCRIPTION                     Unit Price          Amount
  1      6     Pcs     OIL SEAL NOK AE2838-EC (TC 50 65 9)   Rp    45.000   Rp   270.000
                       Note: Garansi 6 bulan terhitung dari pengiriman.
                                                        TOTAL         Rp       299.700
"""


def _line_rec(*requests: str) -> Record:
    return {"lines": [{"request": r, "offer": None} for r in requests]}


def test_content_in_pdf_needs_the_part_numbers() -> None:
    other = _line_rec("OIL SEAL NOK SB 40-55-9", "OIL SEAL NOK AE 2847A", "O RING JIS B2401 G-35")
    assert content_in_pdf(other, _Q639_PDF) is False
    assert content_in_pdf(_line_rec("Oil seal NOK AE2838-EC", "Bolt"), _Q639_PDF) is True
    assert content_in_pdf(_line_rec("Garansi pengiriman bulan"), _Q639_PDF) is True


def test_compare_totals_names_a_workbook_holding_other_content() -> None:
    c = {"gross": 515000.0, "discount": 0.0, "net": 515000.0, "dpp": None, "ppn": 0.0,
         "grand": 515000.0}  # fmt: skip
    rec = _totals_rec(c, None, pdf=299700)
    rec["pdf_content"] = False
    (m,) = compare_totals(rec)
    assert (m["source"], m["cause"]) == ("pdf", "workbook_holds_other_content")


def test_classify_unmatched_pdfs() -> None:
    attached = {"path": "PDF/Q-953250 (V-95-256-E-03).pdf", "number": "Q-953250/GNS/VIII/2025",
                "date": "2025-08-12", "grand": 41234567}  # fmt: skip
    rec = {"pdf": attached}
    copy = {**attached, "path": "PDF/Q-956250 (V-95-256-E-03).pdf"}
    same_total = {**attached, "path": "PDF/Q-956250 (V-95-257-E).pdf",
                  "number": "Q-956250/GNS/VIII/2025"}  # fmt: skip
    alone = {"path": "PDF/Q-502 (Req 901).pdf", "number": "Q-502/GNS/VII/2024",
             "date": "2024-07-20", "grand": 112233440}  # fmt: skip
    classify_unmatched([copy, same_total, alone], [rec])
    assert copy["status"] == "copy of PDF/Q-953250 (V-95-256-E-03).pdf"
    assert same_total["status"] == (
        "same grand total as PDF/Q-953250 (V-95-256-E-03).pdf (Q-953250/GNS/VIII/2025)"
    )
    assert alone["status"] == "no workbook"
