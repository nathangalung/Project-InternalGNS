"""Synthetic tests for request codes, kinds, headings and merge decisions."""

from __future__ import annotations

from typing import Any

from clean_products import build_products, impa_check, item_kind, request_code_check

Doc = dict[str, Any]


def line(
    no: int, request: str, offer: str | None = None, impa: str | None = None, **kw: object
) -> Doc:
    base: Doc = {
        "line_no": no,
        "request": request,
        "offer": offer,
        "available": True,
        "impa": impa,
        "impa_problem": None,
        "impa_raw": None,
        "impa_in_text": [],
        "unit": "PCS",
        "unit_raw": "pcs",
        "unit_mapped": True,
        "sell": 1_000.0,
        "line_total": 1_000.0,
    }
    return base | kw


def quote(qid: str, *lines: Doc) -> Doc:
    return {"id": qid, "lines": list(lines)}


def test_a_request_code_stays_off_a_product_of_another_size() -> None:
    offered = line(1, "Calipers Outside\nCALIPER OUTSIDE 125MM", "CALIPER OUTSIDE 150MM", "650102")
    assert "125mm" in (request_code_check(offered, "650102", offered["offer"]) or "")
    same = line(2, "CALIPER OUTSIDE 150MM", 'CALIPER OUTSIDE 150MM (6")', "650103")
    assert request_code_check(same, "650103", same["offer"]) is None
    chain = line(3, "CHECKER PLATE 6.0X1219X2438MM", "Checker plate 6mm", "670818")
    assert request_code_check(chain, "670818", chain["offer"]) is None


def test_a_cleared_request_code_is_reported_and_kept_off_the_product() -> None:
    cat = build_products(
        [quote("q1", line(1, "DESCALING LIQUID 350 LTR", "DESCALING LIQUID 25 Ltr/PAIL", "571653"))]
    )
    (p,) = cat.products
    assert p["impa_code"] is None and p["rejected_impa"] == ["571653"]
    assert {r["reason"] for r in cat.review} >= {"impa_request_differs"}


def test_codes_from_another_section_are_rejected() -> None:
    assert impa_check("815407", "AIR COMPRESSOR SMALL", "AIR COMPRESSOR SMALL")
    assert impa_check("312265", "International Code of Signals, 2005 Edition", "x")
    assert impa_check("812252", "Devcon putty 10110", "Devcon putty 10110") is None


def test_freight_and_boat_lines_are_services() -> None:
    for text in (
        "Air freight port to port",
        "Boat to vessel",
        "[DELIVERY CHARGES] stores",
        "BIAYA CARGO BANDARA",
    ):
        assert item_kind(text) == "service", text
    for text in ("Cargo net 3x3m", "Boat hook aluminium", "Service kit pump"):
        assert item_kind(text) == "product", text


def test_a_trade_in_credit_is_not_a_product() -> None:
    cat = build_products(
        [
            quote(
                "q1",
                line(1, "Compressor"),
                line(2, "Trade-in old compressor", sell=-500.0, line_total=-500.0),
            )
        ]
    )
    assert [p["name"] for p in cat.products] == ["Compressor"]


def test_products_sharing_a_heading_take_their_distinguishing_line() -> None:
    cat = build_products(
        [
            quote(
                "q1",
                line(1, "HAND SNAP\nKAIN PEL"),
                line(2, "HAND SNAP\nSAPU IJUK"),
                line(3, 'Valve gear ops\nWCB 10K 4"'),
            )
        ]
    )
    names = sorted(p["name"] for p in cat.products)
    assert names == ["HAND SNAP - KAIN PEL", "HAND SNAP - SAPU IJUK", "Valve gear ops"]


def test_an_offer_code_the_product_cannot_take_tells_sizes_apart() -> None:
    cat = build_products(
        [
            quote(
                "q1",
                line(1, "Gland packing", "Gland Packing PTFE Impa 810385", "815407"),
                line(2, "Gland packing", "Gland Packing PTFE Impa 810386", "815408"),
            )
        ]
    )
    assert sorted(p["name"] for p in cat.products) == [
        "Gland Packing PTFE - IMPA 810385",
        "Gland Packing PTFE - IMPA 810386",
    ]


def test_a_merge_decision_joins_spelling_variants() -> None:
    lines = [line(1, "Oil Seal Hallite DHS 28"), line(2, "OIL SEAL HILLITE DHS 28")]
    assert len(build_products([quote("q1", *lines)]).products) == 2
    decided = [{"action": "merge", "lines": [["q1", 1], ["q1", 2]], "reason": "typo"}]
    (p,) = build_products([quote("q1", *lines)], decided).products
    assert p["line_count"] == 2
