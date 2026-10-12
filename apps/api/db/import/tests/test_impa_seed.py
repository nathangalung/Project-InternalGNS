"""The seed stores each IMPA code once, as the app does (invented data)."""

from __future__ import annotations

from helpers import inputs, invoice_doc, line, po_doc, staged
from seed_model import build


def test_products_requests_and_po_lines_keep_their_code_once() -> None:
    rec = staged(
        "a.xlsx#S",
        "Q-1/GNS/I/2026",
        "2026-10-03",
        [
            line(1, 100, 50, request="Kunci Ring (IMPA 611234)", impa="611234"),
            line(2, 100, 50, request="SARUNG TANGAN KATUN IMPA 191234"),
            line(3, 100, 50, request="TALI - IMPA 211234"),
            line(4, 100, 50, request="Tali Tambat", impa="211234"),
        ],
    )
    inp = inputs(
        [rec],
        [
            po_doc(
                rec,
                [
                    {
                        "no": 1,
                        "qty": 1,
                        "unit_price": 100,
                        "quote_row": 15,
                        "description": "Kunci Ring IMPA 611234",
                    }
                ],
            )
        ],
    )
    inp.products[0]["impa_code"] = "611234"
    inp.products[3]["impa_code"] = "211234"

    model = build(inp)

    products = {p.pid: (p.name, p.impa) for p in model.products}
    assert products["P0001"] == ("Kunci Ring", "611234")
    # A marked code fills an empty one when no other product holds it.
    assert products["P0002"] == ("SARUNG TANGAN KATUN", "191234")
    # Another product holds 211234, so it stays where it was written.
    assert products["P0003"] == ("TALI - IMPA 211234", None)
    assert products["P0004"] == ("Tali Tambat", "211234")

    (q,) = model.quotations
    requests = [(ln.requested_name, ln.requested_impa) for ln in q.lines]
    assert requests == [
        ("Kunci Ring", "611234"),
        ("SARUNG TANGAN KATUN", "191234"),
        # A request has no unique code, so its marked code always moves.
        ("TALI", "211234"),
        ("Tali Tambat", "211234"),
    ]

    (po,) = model.pos
    assert [(ln.item_name, ln.item_code) for ln in po.lines if ln.item_type == "product"] == [
        ("Kunci Ring", "611234")
    ]


def test_an_invoice_line_keeps_what_was_filed() -> None:
    # Invoice lines match what went to DJP, so their text is never cleaned.
    rec = staged("b.xlsx#S", "Q-2/GNS/I/2026", "2026-01-05", [line(1, 1000, impa="591234")])
    po = po_doc(
        rec,
        [
            {
                "no": 1,
                "qty": 1,
                "unit_price": 1000,
                "quote_row": 15,
                "description": "Ember IMPA 591234",
            }
        ],
    )
    inp = inputs([rec], [po], [invoice_doc(po, "2/INV", "2026-09-04")])
    inp.products[0]["impa_code"] = "591234"
    model = build(inp)
    (po_line,) = [ln for ln in model.pos[0].lines if ln.item_type == "product"]
    assert (po_line.item_name, po_line.item_code) == ("Ember", "591234")
    (inv,) = model.invoices
    assert [ln.item_name for ln in inv.lines] == ["Ember IMPA 591234"]
