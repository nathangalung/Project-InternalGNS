"""Unit tests for the historical seed rules (no database)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

import pytest

from build_seed import report
from helpers import inputs, line, staged
from seed_model import (
    AS_OF,
    UNPRICED_REASON,
    Model,
    QLine,
    build,
    doc_number,
    monotonic,
    natural_key,
    quotation_status,
    quotation_totals,
    revision_number,
    rupiah,
    shipping_days,
    split_discount,
    split_total,
    vendor_key,
)
from seed_sql import render

Doc = dict[str, Any]
D = Decimal


# Numbers
def test_doc_number_is_five_digits_with_roman_month() -> None:
    assert doc_number("Q", 11, date(2026, 10, 3)) == "Q-00011/GNS/X/2026"
    assert doc_number("INV", 7, date(2025, 1, 31)) == "INV-00007/GNS/I/2025"
    assert doc_number("DN", 123456, date(2024, 12, 1)) == "DN-123456/GNS/XII/2024"


def test_revision_number_matches_buat_revisi() -> None:
    assert revision_number("Q-00011/GNS/X/2026", 1) == "Q-00011/GNS/X/2026 Rev.1"


def test_natural_key_orders_numbers_by_value() -> None:
    assert sorted(["Q-10/GNS", "Q-9/GNS", "Q-100/GNS"], key=natural_key) == [
        "Q-9/GNS",
        "Q-10/GNS",
        "Q-100/GNS",
    ]


def test_numbers_follow_date_then_original_number() -> None:
    model = build(
        inputs(
            [
                staged("b.xlsx#S", "Q-20/GNS/III/2025", "2025-03-02", [line(1, 100)]),
                staged("a.xlsx#S", "Q-30/GNS/III/2025", "2025-03-01", [line(1, 100)]),
                staged("c.xlsx#S", "Q-10/GNS/III/2025", "2025-03-02", [line(1, 100)]),
                staged("d.xlsx#S", "Q-5/GNS/I/2026", "2026-01-05", [line(1, 100)]),
            ]
        ),
        as_of=AS_OF,
    )
    got = [(q.original, q.number) for q in model.quotations]
    assert got == [
        ("Q-30/GNS/III/2025", "Q-00001/GNS/III/2025"),
        ("Q-10/GNS/III/2025", "Q-00002/GNS/III/2025"),
        ("Q-20/GNS/III/2025", "Q-00003/GNS/III/2025"),
        ("Q-5/GNS/I/2026", "Q-00004/GNS/I/2026"),
    ]
    assert all(not any(n.startswith("No. asli") for n in q.notes) for q in model.quotations)


def test_revision_chain_keeps_base_number() -> None:
    group = {"group": "g", "count": 2, "base_id": "a.xlsx#S"}
    model = build(
        inputs(
            [
                staged(
                    "a.xlsx#S",
                    "Q-1/GNS/V/2025",
                    "2025-05-01",
                    [line(1, 100)],
                    revision=group | {"index": 0},
                ),
                staged(
                    "b.xlsx#S",
                    "Q-1-R/GNS/V/2025",
                    "2025-05-03",
                    [line(1, 90)],
                    revision=group | {"index": 1},
                ),
            ]
        )
    )
    base, rev = model.quotations
    assert (base.number, base.version, base.status) == ("Q-00001/GNS/V/2025", 1, "revision")
    assert (rev.number, rev.version, rev.parent) == ("Q-00001/GNS/V/2025 Rev.1", 2, base)
    assert base.history[-1].to_status == "revision"
    assert base.history[-1].note == "Direvisi menjadi Q-00001/GNS/V/2025 Rev.1"
    assert rev.history[0].note == "Revisi dari Q-00001/GNS/V/2025"


def test_missing_date_takes_nearest_earlier_number() -> None:
    model = build(
        inputs(
            [
                staged("a.xlsx#S", "Q-544/GNS/VIII/2024", "2024-08-20", [line(1, 100)]),
                staged("b.xlsx#S", "Q-545/GNS/VIII/2024", "2024-08-29", [line(1, 100)]),
                staged("c.xlsx#S", "Q-546", None, [line(1, 100)], year=2024),
            ]
        )
    )
    q546 = next(q for q in model.quotations if q.original == "Q-546")
    assert q546.date == date(2024, 8, 29)
    assert any(r == "Q-546" for r, _ in model.flagged)


# Status
@pytest.mark.parametrize(
    ("kw", "want"),
    [
        ({"has_po": True}, "accepted"),
        ({"superseded": True, "has_po": True}, "revision"),
        ({"day": date(2026, 9, 30), "validity": 3}, "expired"),
        ({"day": date(2026, 10, 1), "validity": 3}, "sent"),
        ({"day": date(2024, 1, 1), "validity": None}, "sent"),
        ({"unpriced": True, "year": 2026}, "draft"),
        ({"unpriced": True, "year": 2025, "priced_cost": True}, "cancelled"),
        ({"unpriced": True, "year": 2024, "priced_cost": False}, None),
    ],
)
def test_quotation_status(kw: dict[str, Any], want: str | None) -> None:
    args: dict[str, Any] = {
        "has_po": False,
        "superseded": False,
        "unpriced": False,
        "priced_cost": False,
        "year": 2026,
        "day": date(2026, 9, 1),
        "validity": 3,
        "as_of": AS_OF,
    }
    assert quotation_status(**(args | kw)) == want


def test_unpriced_rule_drafts_cancels_and_skips() -> None:
    model = build(
        inputs(
            [
                staged("a.xlsx#S", "Q-1/GNS/I/2026", "2026-01-02", [line(1, None)]),
                staged("b.xlsx#S", "Q-2/GNS/I/2025", "2025-01-02", [line(1, None, 5000)]),
                staged("c.xlsx#S", "Q-3/GNS/I/2025", "2025-01-03", [line(1, None)]),
            ]
        )
    )
    status = {q.original: q.status for q in model.quotations}
    assert status == {"Q-1/GNS/I/2026": "draft", "Q-2/GNS/I/2025": "cancelled"}
    assert [n for n, _ in model.skipped] == ["Q-3/GNS/I/2025"]
    cancelled = next(q for q in model.quotations if q.status == "cancelled")
    assert [(h.to_status, h.note) for h in cancelled.history] == [
        ("draft", "Quotation dibuat"),
        ("cancelled", UNPRICED_REASON),
    ]


def test_expired_history_is_a_system_move() -> None:
    model = build(inputs([staged("a.xlsx#S", "Q-1/GNS/I/2025", "2025-01-02", [line(1, 100)])]))
    (q,) = model.quotations
    assert [h.to_status for h in q.history] == ["draft", "sent", "expired"]
    expired = q.history[-1]
    assert expired.system
    assert expired.at.date() == date(2025, 1, 5)
    assert expired.note == "Kedaluwarsa otomatis: masa berlaku 3 hari sejak 02-01-2025 telah lewat."


# Lines and totals
def test_totals_follow_fn_recompute_quotation_totals() -> None:
    lines = [
        QLine(1, 1, "product", "a", None, None, None, D(3), "PCS", D("1050.00"), None, True),
        QLine(2, 2, "product", "b", None, None, None, D("1.5"), "PCS", D("333.33"), None, True),
        QLine(3, 3, "shipping", "SHIPPING", None, None, None, D(1), "UNIT", D(500), None, True),
    ]
    t = quotation_totals(lines, D(5))
    assert t.total_produk == D("3650.00")
    assert t.total == D("4150.00")
    assert t.total_discount == D("182.50")
    # Per line: 2992.50, 475.00, 500.00 -> DPP 2743.13 + 435.42 + 458.33
    assert t.dpp == D("3636.88")
    assert t.ppn == D("329.18") + D("52.25") + D("55.00")
    assert t.grand == t.total - t.total_discount + t.ppn


def test_no_offer_line_is_unpriced_and_vendorless() -> None:
    model = build(
        inputs(
            [
                staged(
                    "a.xlsx#S",
                    "Q-1/GNS/I/2026",
                    "2026-10-03",
                    [
                        line(1, 100, 50, vendor="Toko A"),
                        line(2, None, 70, vendor="Toko B", available=False),
                    ],
                )
            ]
        )
    )
    (q,) = model.quotations
    offered, no_offer = q.lines
    assert offered.link is not None and offered.link.vendor.name == "Toko A"
    assert (no_offer.available, no_offer.sell, no_offer.cost, no_offer.link) == (
        False,
        D(0),
        None,
        None,
    )
    assert [v.name for v in model.vendors] == ["Toko A"]


def test_line_out_of_print_total_is_kept_and_noted() -> None:
    model = build(
        inputs(
            [
                staged(
                    "a.xlsx#S",
                    "Q-1/GNS/I/2026",
                    "2026-10-03",
                    [line(1, 100), line(2, 50, in_total=False)],
                    print_totals={"grand": 111.0},
                )
            ]
        )
    )
    (q,) = model.quotations
    assert len(q.lines) == 2
    assert "Baris tidak termasuk total tercetak: 2" in q.notes
    assert "Grand total tercetak: Rp 111" in q.notes


def test_missing_or_zero_quantity_is_stored_above_zero() -> None:
    model = build(
        inputs(
            [
                staged(
                    "a.xlsx#S",
                    "Q-1/GNS/I/2026",
                    "2026-10-03",
                    [line(1, 100, qty=None, line_total=500), line(2, 0, qty=0)],
                )
            ]
        )
    )
    assert [ln.qty for ln in model.quotations[0].lines] == [D(5), D(1)]


def test_vendor_names_merge_on_letters_and_digits() -> None:
    assert vendor_key("Sindo Seal") == vendor_key("SindoSeal") == vendor_key("sindo  seal.")


def test_shipping_days_reads_only_a_leading_day_count() -> None:
    assert shipping_days("3 working days after PO received") == 3
    assert shipping_days("5 days after PO doc received") == 5
    assert shipping_days("Ready stock") is None
    assert shipping_days("7-10 working days") is None


# Allocation helpers
def test_split_discount_sums_exactly() -> None:
    nets = split_discount([D("100.00"), D("200.00"), D("33.33")], D("16.67"))
    assert sum(nets) == D("316.66")


def test_split_total_takes_the_rest_on_the_last_line() -> None:
    parts = split_total([D("100.00"), D("100.00"), D("100.00")], D("33.01"), D(11))
    assert parts == [D("11.00"), D("11.00"), D("11.01")]


def test_monotonic_spaces_same_day_moves() -> None:
    h = monotonic(
        [
            (date(2025, 1, 2), None, "draft", None, False),
            (date(2025, 1, 2), "draft", "sent", None, False),
            (date(2025, 1, 1), "sent", "accepted", None, False),
        ]
    )
    assert [x.at.strftime("%Y-%m-%d %H:%M %z") for x in h] == [
        "2025-01-02 09:00 +0700",
        "2025-01-02 09:01 +0700",
        "2025-01-02 09:02 +0700",
    ]


def test_rupiah_uses_indonesian_separators() -> None:
    assert rupiah(D("1234567")) == "Rp 1.234.567"
    assert rupiah(D("-652.68")) == "Rp -652,68"


# Determinism
def test_output_is_deterministic() -> None:
    def make() -> Model:
        return build(inputs([staged("a.xlsx#S", "Q-1/GNS/I/2025", "2025-01-02", [line(1, 100)])]))

    assert render(make()) == render(make())
    assert report(make()) == report(make())
