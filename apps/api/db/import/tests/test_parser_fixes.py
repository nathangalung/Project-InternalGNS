"""Synthetic tests for request/offer rows, units, side sheets and signing lines."""

from __future__ import annotations

from typing import Any

from dedup import _chain_order
from quotation import _fill_costs, is_signing_line, merge_offer_rows, normalize_line
from sheets import Line


def row(r: int, no: str | None, request: str, **kw: object) -> Line:
    base: dict[str, Any] = {"row": r, "no": no, "qty": None, "unit": None, "request": request}
    base["offer"] = kw.pop("offer", None)
    return Line(**(base | kw))


def test_request_row_answered_once_is_one_line() -> None:
    lines, headings = merge_offer_rows(
        [
            row(14, "1", "Cleaning grit for turbo\nOffer:", qty=50, unit="kg", impa="232900"),
            row(15, None, "Grit, 3 bags", qty=3, unit="pcs", sell=700_000, cost=450_000),
            row(16, "2", "Next item", qty=1, unit="pcs", sell=10_000),
        ]
    )
    assert headings == []
    first, second = lines
    assert (first.no, first.row, first.request) == ("1", 15, "Cleaning grit for turbo")
    assert (first.offer, first.qty, first.unit, first.sell) == ("Grit, 3 bags", 3, "pcs", 700_000)
    assert first.impa == "232900"
    assert second.request == "Next item"


def test_answer_without_quantity_takes_the_request_quantity() -> None:
    (line,), _ = merge_offer_rows(
        [
            row(15, "1", "Motor control breaker", qty=1, unit="Set"),
            row(16, None, "Breaker 250 A brand X", sell=1_000_000),
        ]
    )
    assert (line.qty, line.unit, line.offer) == (1, "Set", "Breaker 250 A brand X")


def test_several_answers_are_options_named_after_the_request() -> None:
    lines, _ = merge_offer_rows(
        [
            row(14, "1", "Seal 12 x 57 mm", qty=1, unit="Pcs", vendor="Toko Seal"),
            row(15, None, "Original", qty=1, sell=750_000),
            row(16, None, "Copy ", qty=1, sell=250_000),
        ]
    )
    assert [ln.offer for ln in lines] == ["Seal 12 x 57 mm - Original", "Seal 12 x 57 mm - Copy"]
    assert {ln.unit for ln in lines} == {"Pcs"}
    assert {ln.vendor for ln in lines} == {"Toko Seal"}
    assert {ln.no for ln in lines} == {"1"}


def test_heading_with_a_colon_is_never_a_line() -> None:
    lines, headings = merge_offer_rows(
        [row(10, "4", "WARNING SIGNS :"), row(11, "5", "Rope", qty=2, sell=5_000)]
    )
    assert [h.row for h in headings] == [10]
    assert [ln.request for ln in lines] == ["Rope"]


def test_signs_under_a_heading_become_named_lines() -> None:
    lines, headings = merge_offer_rows(
        [
            row(10, "4", "WARNING SIGNS :"),
            row(11, None, "- KEEP OUT - 3 PCS", qty=3, unit="pcs", sell=5_000),
            row(12, None, "- NO SMOKING - 2 PCS", qty=2, unit="pcs", sell=5_000),
        ]
    )
    assert headings == []
    assert [ln.offer for ln in lines] == [
        "WARNING SIGNS - KEEP OUT - 3 PCS",
        "WARNING SIGNS - NO SMOKING - 2 PCS",
    ]


def test_priced_request_rows_are_left_alone() -> None:
    rows = [
        row(14, "1", "Kit", qty=1, sell=100_000, sell_amount=100_000),
        row(15, None, "Kit part", qty=1, sell=20_000, sell_amount=20_000),
    ]
    assert merge_offer_rows(rows) == (rows, [])


def test_quantity_from_amount_takes_the_unit_the_text_counts() -> None:
    ln = row(
        15, "1", "Sealing tape 10 m (40 roll)", qty=400, unit="meter", sell=17_000,
        sell_amount=680_000, cost=8_000, cost_amount=320_000,
    )  # fmt: skip
    rec = normalize_line(ln, has_amount=True)
    assert (rec["qty"], rec["unit"]) == (40.0, "RLS")
    assert "unit_from_text" in rec["flags"]


def test_a_dozen_priced_as_pieces_is_counted_in_pieces() -> None:
    ln = row(
        15, "1", "Paint roller", qty=1, unit="Lusin", sell=9_000, sell_amount=108_000,
        cost=6_000, cost_amount=72_000,
    )  # fmt: skip
    rec = normalize_line(ln, has_amount=True)
    assert (rec["qty"], rec["unit"]) == (12.0, "PCS")


def _rec_line(
    request: str, sell: float, cost: float | None = None, vendor: str | None = None
) -> dict:
    return {
        "request": request,
        "offer": None,
        "sell": sell,
        "cost": cost,
        "vendor": vendor,
        "channel": None,
        "nama_asli": None,
        "available": True,
        "flags": [],
    }


def test_revision_sheet_takes_costs_from_the_workbook() -> None:
    rec = {"lines": [_rec_line("Plasma cutter 100A", 2_000_000), _rec_line("Lamp 18W", 30_000)]}
    side = [
        _rec_line("Plasma cutter 100A", 2_100_000, 1_500_000, "Shop A"),
        _rec_line("Plasma cutter 100A", 2_000_000, 1_400_000, "Shop B"),
    ]
    _fill_costs(rec, side)
    cutter, lamp = rec["lines"]
    assert (cutter["cost"], cutter["vendor"]) == (1_400_000, "Shop B")
    assert "cost_from_workbook" in cutter["flags"]
    assert lamp["cost"] is None


def test_signing_line_is_not_a_delivery_time() -> None:
    assert is_signing_line("Jakarta, 20 Juli 2024")
    assert not is_signing_line("3 working days after PO received")
    assert not is_signing_line(None)


def _chained(path: str, modified: str | None) -> dict:
    return {
        "date": "2026-07-13",
        "file_name": {"markers": []},
        "source": {"kind": "data_entry", "files": [path], "modified": modified},
    }


def test_revisions_of_one_day_follow_the_saved_time() -> None:
    later = _chained("A later saved.xlsx", "2026-08-03T10:29:45")
    earlier = _chained("B earlier saved.xlsx", "2026-07-13T04:54:10")
    assert sorted([later, earlier], key=_chain_order) == [earlier, later]
