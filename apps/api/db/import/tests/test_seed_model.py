"""Unit tests for the historical seed rules (no database)."""

from __future__ import annotations

import re
from datetime import date
from decimal import Decimal
from typing import Any

import pytest

from build_seed import report
from helpers import inputs, invoice_doc, line, po_doc, staged
from seed_model import (
    PAID_BEFORE,
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
    yearly_numbers,
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
        )
    )
    got = [(q.original, q.number) for q in model.quotations]
    assert got == [
        ("Q-30/GNS/III/2025", "Q-00001/GNS/III/2025"),
        ("Q-10/GNS/III/2025", "Q-00002/GNS/III/2025"),
        ("Q-20/GNS/III/2025", "Q-00003/GNS/III/2025"),
        ("Q-5/GNS/I/2026", "Q-00001/GNS/I/2026"),
    ]
    assert all(not any(n.startswith("No. asli") for n in q.notes) for q in model.quotations)


def test_yearly_numbers_restart_each_year() -> None:
    days = [date(2025, 11, 3), date(2025, 12, 30), date(2026, 1, 2), date(2026, 1, 2)]
    assert yearly_numbers("INV", days) == [
        (1, "INV-00001/GNS/XI/2025"),
        (2, "INV-00002/GNS/XII/2025"),
        (1, "INV-00001/GNS/I/2026"),
        (2, "INV-00002/GNS/I/2026"),
    ]


def test_a_revision_keeps_its_base_year() -> None:
    group = {"group": "g", "count": 2, "base_id": "a.xlsx#S"}
    model = build(
        inputs(
            [
                staged(
                    "a.xlsx#S",
                    "Q-7/GNS/XII/2025",
                    "2025-12-30",
                    [line(1, 100)],
                    revision=group | {"index": 0},
                ),
                staged(
                    "b.xlsx#S",
                    "Q-7-R/GNS/I/2026",
                    "2026-01-05",
                    [line(1, 90)],
                    revision=group | {"index": 1},
                ),
                staged("c.xlsx#S", "Q-8/GNS/I/2026", "2026-01-02", [line(1, 100)]),
            ]
        )
    )
    got = [(q.original, q.number, q.id) for q in model.quotations]
    assert got == [
        ("Q-7/GNS/XII/2025", "Q-00001/GNS/XII/2025", 1),
        ("Q-7-R/GNS/I/2026", "Q-00001/GNS/XII/2025 Rev.1", 2),
        ("Q-8/GNS/I/2026", "Q-00001/GNS/I/2026", 3),
    ]


def _two_years() -> Model:
    recs, pos, invs = [], [], []
    for i, (quoted, billed) in enumerate(
        [("2025-12-01", "2025-12-20"), ("2026-01-03", "2026-01-10"), ("2026-01-04", "2026-02-01")],
        1,
    ):
        rec = staged(f"q{i}.xlsx#S", f"Q-{i}/GNS/I/2026", quoted, [line(1, 1000)])
        po = po_doc(
            rec,
            [{"no": 1, "qty": 1, "unit_price": 1000, "quote_row": 15}],
            client_po_number=f"PO-{i}",
        )
        recs.append(rec)
        pos.append(po)
        invs.append(invoice_doc(po, f"{i}/INV", billed))
    return build(inputs(recs, pos, invs))


def test_invoices_and_delivery_notes_restart_each_year() -> None:
    model = _two_years()
    assert [(inv.number, inv.id) for inv in model.invoices] == [
        ("INV-00001/GNS/XII/2025", 1),
        ("INV-00001/GNS/I/2026", 2),
        ("INV-00002/GNS/II/2026", 3),
    ]
    assert sorted(po.dn_number for po in model.pos) == [
        "DN-00001/GNS/I/2026",
        "DN-00001/GNS/XII/2025",
        "DN-00002/GNS/II/2026",
    ]
    assert [q.number for q in model.quotations] == [
        "Q-00001/GNS/XII/2025",
        "Q-00001/GNS/I/2026",
        "Q-00002/GNS/I/2026",
    ]


def test_the_seed_sets_a_counter_per_type_and_year() -> None:
    sql = render(_two_years())
    assert "DELETE FROM doc_counters;" in sql
    rows = re.findall(
        r"\('(Q|INV|DN)', ([0-9]{4}), ([0-9]+)\)", sql.split("DELETE FROM doc_counters;")[1]
    )
    assert sorted(rows) == [
        ("DN", "2025", "1"),
        ("DN", "2026", "2"),
        ("INV", "2025", "1"),
        ("INV", "2026", "2"),
        ("Q", "2025", "1"),
        ("Q", "2026", "2"),
    ]


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
        ({}, "sent"),
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


def test_a_quotation_past_its_validity_stays_sent() -> None:
    model = build(inputs([staged("a.xlsx#S", "Q-1/GNS/I/2025", "2025-01-02", [line(1, 100)])]))
    (q,) = model.quotations
    assert q.status == "sent"
    assert [(h.from_status, h.to_status) for h in q.history] == [(None, "draft"), ("draft", "sent")]


# Invoice status
def _invoiced(day: str, due: str | None) -> Model:
    rec = staged("a.xlsx#S", "Q-1/GNS/I/2026", "2026-01-05", [line(1, 1000)])
    po = po_doc(rec, [{"no": 1, "qty": 1, "unit_price": 1000, "quote_row": 15}])
    return build(inputs([rec], [po], [invoice_doc(po, "1/INV", day, due_date=due)]))


def test_an_invoice_before_the_cutoff_is_paid_on_its_due_date() -> None:
    (inv,) = _invoiced("2026-09-04", "2026-10-04").invoices
    assert date(2026, 9, 4) < PAID_BEFORE
    assert inv.status == "paid"
    assert [(h.from_status, h.to_status) for h in inv.history] == [
        ("draft", "sent"),
        ("sent", "paid"),
    ]
    assert inv.paid_at == inv.history[-1].at
    assert inv.paid_at is not None
    assert inv.paid_at.strftime("%Y-%m-%d %H:%M %z") == "2026-10-04 09:00 +0700"


def test_an_invoice_from_the_cutoff_stays_sent() -> None:
    (inv,) = _invoiced(PAID_BEFORE.isoformat(), "2026-10-05").invoices
    assert inv.status == "sent"
    assert inv.paid_at is None
    assert [h.to_status for h in inv.history] == ["sent"]


def test_a_paid_invoice_without_a_due_date_is_paid_after_it_is_sent() -> None:
    (inv,) = _invoiced("2026-03-02", None).invoices
    sent, paid = inv.history
    assert inv.status == "paid"
    assert paid.at.date() == date(2026, 3, 2)
    assert paid.at > sent.at
    assert inv.paid_at == paid.at


def test_the_seed_writes_the_invoice_status_and_paid_at() -> None:
    sql = render(_invoiced("2026-09-04", "2026-10-04"))
    assert "'paid'" in sql
    assert "'2026-10-04 09:00:00+07'" in sql


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
            (date(2025, 1, 2), None, "draft", None),
            (date(2025, 1, 2), "draft", "sent", None),
            (date(2025, 1, 1), "sent", "accepted", None),
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
