"""Synthetic tests for the audit fixes in the seed rules."""

from __future__ import annotations

from decimal import Decimal as D

from helpers import Doc, inputs, invoice_doc, line, po_doc, staged
from seed_model import build, same_vessel


def test_a_credit_line_is_left_out_and_noted() -> None:
    credit = line(2, -500, request="Trade-in old pump", line_total=-500)
    (q,) = build(
        inputs([staged("a.xlsx#S", "Q-1/GNS/I/2026", "2026-10-03", [line(1, 1000), credit])])
    ).quotations
    assert [ln.requested_name for ln in q.lines] == ["Item 1"]
    assert "Baris tercetak 'Trade-in old pump' Rp -500 tidak disimpan (nilai negatif)" in q.notes


def test_the_printed_delivery_place_is_the_shipping_destination() -> None:
    terms = {"payment": "30 days", "validity_days": 3, "delivery_time": None}
    rec = staged(
        "a.xlsx#S",
        "Q-1/GNS/I/2026",
        "2026-10-03",
        [line(1, 1000)],
        terms=terms | {"delivery_place": "Franco Contoh"},
        extras=[{"label": "Delivery to ship", "amount": 50, "taxed": True}],
    )
    plain = staged(
        "b.xlsx#S",
        "Q-2/GNS/I/2026",
        "2026-10-03",
        [line(1, 1000)],
        terms=terms | {"delivery_place": "Gudang Contoh"},
    )
    charged, free = build(inputs([rec, plain])).quotations
    ship = charged.lines[-1]
    assert (ship.item_type, ship.requested_name, ship.ship_destination, ship.sell) == (
        "shipping",
        "SHIPPING — Delivery to ship",
        "Franco Contoh",
        D(50),
    )
    ship = free.lines[-1]
    assert (ship.item_type, ship.ship_destination, ship.sell) == ("shipping", "Gudang Contoh", 0)


def test_a_quotation_read_from_its_pdf_compares_with_the_pdf_total() -> None:
    pdf = {"path": "a.pdf", "number": "Q-1/GNS/I/2026", "grand": 1110.0}
    read = staged(
        "a.xlsx#S",
        "Q-1/GNS/I/2026",
        "2026-10-03",
        [line(1, 1000)],
        print_totals={"grand": 999.0},
        pdf=pdf,
        flags=["lines_from_pdf"],
    )
    unread = staged(
        "b.xlsx#S",
        "Q-2/GNS/I/2026",
        "2026-10-03",
        [line(1, 1000)],
        pdf=pdf | {"grand": 5000.0},
        flags=["pdf_lines_unread"],
    )
    a, b = build(inputs([read, unread])).quotations
    assert a.printed_grand == D("1110.0")
    assert not [n for n in a.notes if n.startswith("Grand total")]
    assert "Grand total tercetak (PDF): Rp 5.000" in b.notes


def test_the_legacy_number_is_the_issued_one_and_other_numbers_are_noted() -> None:
    number = {"original": "Q-17/GNS/I/2026 - REQ 9/D/1/26", "print": None, "pdf": None}
    suffixed = staged("a.xlsx#S", "Q-17/GNS/I/2026", "2026-10-03", [line(1, 1000)])
    suffixed["number"] = number
    copied = staged(
        "b.xlsx#S",
        "Q-20/GNS/I/2026",
        "2026-10-03",
        [line(1, 1000)],
        aliases=[
            {"number": "Q-21/GNS/I/2026", "differs": ["number", "cost"]},
            {"number": "Q-22/GNS/I/2026", "differs": ["number"]},
            {"number": "Q-20/GNS/I/2026", "differs": []},
        ],
    )
    copied["number"]["pdf"] = "Q-21/GNS/I/2026"
    a, b = build(inputs([suffixed, copied])).quotations
    assert (a.legacy, [n for n in a.notes if n.startswith("Juga")]) == ("Q-17/GNS/I/2026", [])
    assert b.legacy == "Q-21/GNS/I/2026"
    assert "Juga tercatat dengan No. Q-20/GNS/I/2026, Q-22/GNS/I/2026" in b.notes


def _quoted() -> Doc:
    terms = {"payment": "30 days", "validity_days": 3, "delivery_time": "3 days after PO"}
    return staged(
        "a.xlsx#S",
        "Q-1/GNS/I/2026",
        "2026-10-01",
        [line(1, 1000), line(2, 500), line(3, None, available=False)],
        terms=terms | {"delivery_place": "Gudang Klien"},
        vessel="MV CONTOH SATU",
    )


def test_a_po_leaves_out_unpriced_positions_and_ships_where_it_says() -> None:
    rec = _quoted()
    po = po_doc(
        rec,
        [
            {"no": 1, "qty": 2, "unit_price": 1000, "quote_row": 15},
            {"no": 2, "qty": 1, "unit_price": 0, "quote_row": 17},
            {"no": 3, "qty": 1, "unit_price": 500, "quote_row": 16},
        ],
        delivery_place="PELABUHAN CONTOH",
        user_end="CONTOH DUA",
    )
    model = build(inputs([rec], [po], [invoice_doc(po, "1/INV", "2026-10-02")]))
    (order,) = model.pos
    assert [(ln.item_type, ln.sell) for ln in order.lines] == [
        ("product", D(1000)),
        ("product", D(500)),
        ("shipping", D(0)),
    ]
    assert (order.lines[-1].ship_destination, order.lines[-1].shipping_days) == (
        "PELABUHAN CONTOH",
        3,
    )
    assert "Posisi 2 di PO klien bernilai Rp 0 (tidak ditawarkan), tidak disimpan" in order.notes
    q = order.quotation
    assert q.vessel == "CONTOH DUA"
    assert "Kapal tercetak di quotation: MV CONTOH SATU; PO klien: CONTOH DUA" in q.notes


def test_the_same_vessel_printed_two_ways_is_left_alone() -> None:
    assert same_vessel("FC PIONEER (SANGATTA)", "TCP Pioneer")
    assert same_vessel("FC DLS", "DLS FC 01")
    assert not same_vessel("MV DAIDAN SATU", "DAIDAN DUA")


def test_a_rebuilt_quotation_has_products_its_po_discount_and_service_codes() -> None:
    rec = staged("x.xlsx#S", "Q-9/GNS/I/2026", "2026-09-01", [line(1, 100)])
    po: Doc = {
        **po_doc(rec, [], client_po_number=None),
        "id": "po:rebuilt",
        "client_po_number_missing_reason": "tidak ada PO",
        "client_printed": "PT. ALPHA\nPT DUA CONTOH",
        "quotation": None,
        "synthetic_quotation": {"date": "2026-10-01", "reason": "di luar berkas"},
        "discount": 50,
        "lines": [
            {"no": 1, "description": "Relay contoh\n24 VDC", "qty": 1, "unit": None,
             "unit_price": 900},
            {"no": 2, "description": "Pengiriman barang ke Contoh", "qty": 1, "unit": None,
             "unit_price": 100},
        ],
    }  # fmt: skip
    model = build(inputs([rec], [po], [invoice_doc(po, "2/INV", "2026-10-02")]))
    q = next(q for q in model.quotations if q.origin == "synthetic")
    assert q.discount_pct == D("5.00")
    assert [(ln.product.name, ln.product.kind, ln.unit) for ln in q.lines if ln.product] == [
        ("Relay contoh", "product", "PCS"),
        ("Pengiriman barang ke Contoh", "service", "UNIT"),
    ]
    (inv,) = model.invoices
    assert [ln.goods_or_service for ln in inv.lines] == ["B", "J"]
    assert "Pihak kedua: PT DUA CONTOH" in q.notes
