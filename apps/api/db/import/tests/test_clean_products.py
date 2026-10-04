"""Unit tests for the product master cleanup."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest

from clean_products import (
    Catalog,
    blocking_guard,
    build_products,
    clean_text_block,
    comparison_key,
    features,
    item_kind,
    line_impa,
    line_source,
)
from helpers import save_workbook
from quotation import build_workbook, normalize_line
from sheets import Line

Record = dict[str, Any]


def _ln(
    request: str,
    offer: str | None = None,
    impa: object = None,
    unit: str | None = "Pcs",
) -> Record:
    return normalize_line(
        Line(row=1, no="1", qty=1.0, unit=unit, request=request, offer=offer, impa=impa),
        has_amount=False,
    )


def _q(qid: str, *lines: Record) -> Record:
    return {"id": qid, "lines": [dict(ln, line_no=i + 1) for i, ln in enumerate(lines)]}


def _item(cat: Catalog, qid: str, line_no: int = 1) -> Record:
    for p in cat.products:
        if {"quotation": qid, "line_no": line_no} in p["source_lines"]:
            return p
    raise AssertionError(f"no item for {qid}:{line_no}")


def _reasons(cat: Catalog, item: Record) -> set[str]:
    return {r["reason"] for r in cat.review if item["id"] in (r["item_id"], r["other_item_id"])}


def _pair_review(cat: Catalog, a: Record, b: Record) -> Record | None:
    for r in cat.review:
        if {r["item_id"], r["other_item_id"]} == {a["id"], b["id"]}:
            return r
    return None


def _outcome(a: tuple[str, object], b: tuple[str, object]) -> str:
    """Tier of a two-line pair: auto, review, blocked:<guard> or separate."""
    cat = build_products([_q("A", _ln(a[0], impa=a[1])), _q("B", _ln(b[0], impa=b[1]))])
    ia, ib = _item(cat, "A"), _item(cat, "B")
    if ia["id"] == ib["id"]:
        return "auto"
    row = _pair_review(cat, ia, ib)
    if row is not None:
        return f"review:{row['reason']}"
    fa, fb = (
        features(clean_text_block(t).text, marks=line_impa(_ln(t, impa=code)).marks)
        for t, code in (a, b)
    )
    guard = blocking_guard(fa, fb, ia["impa_code"], ib["impa_code"])
    return f"blocked:{guard}" if guard else "separate"


# Name cleanup


@pytest.mark.parametrize(
    ("raw", "name", "description"),
    [
        ("⁠- Regulator\xa0 LPG  ", "Regulator LPG", None),
        ("Kain Asbes  3mm", "Kain Asbes 3mm", None),
        ("Pick and Hook Oil Seal&nsbp", "Pick and Hook Oil Seal", None),
        ("SAW DUST 10kgs/bag\nIMPA 232946", "SAW DUST 10kgs/bag", None),
        ("Electrode Holders 500A IMPA 851034", "Electrode Holders 500A", None),
        ("Dust Seal 20x26x3,6mm\nmin.order 5pcs", "Dust Seal 20x26x3,6mm", None),
        (
            "Power Supply UPS Meanwell DRC-180B Meanwell\nNOTE: PRE-ORDER 21 days",
            "Power Supply UPS Meanwell DRC-180B Meanwell",
            None,
        ),
        ("Baygon\nREQUEST BAYGON 600 ml", "Baygon", None),
        ("TINTA PRINTER\nTinta printer HITAM", "Tinta printer HITAM", None),
        (
            "Floatless Level Switch\n61F-GP-N\nInput 100 VAC",
            "Floatless Level Switch",
            "61F-GP-N\nInput 100 VAC",
        ),
        (
            "ITU MM CD MANUAL FOR MARITIME, MOBILE&MARITIME SATE. SERVICE  Publications from"
            " various countries are available.  The most popular publications are listed below.",
            "ITU MM CD MANUAL FOR MARITIME, MOBILE&MARITIME SATE. SERVICE",
            None,
        ),
        (
            "TOOL RIVETER HAND PLIER-TYPE, FOR RIVET DIA 2.4-4.8MM  Designed to set all"
            " standard size of blind rivets.",
            "TOOL RIVETER HAND PLIER-TYPE, FOR RIVET DIA 2.4-4.8MM",
            None,
        ),
        (
            "Brand Powertec Lever hoist                          0.75 Ton x 1.5 Meter",
            "Brand Powertec Lever hoist",
            "0.75 Ton x 1.5 Meter",
        ),
        ("DANGER HIGH VOLTAGE(337610) - 30 PCS", "DANGER HIGH VOLTAGE(337610)", None),
        (
            "alternative:          Lifebouy Self-igniting Lights GLS-10(96) with battery including"
            " plastic bracket, brand Argos/Trivi",
            "Lifebouy Self-igniting Lights GLS-10(96) with battery including plastic bracket,"
            " brand Argos/Trivi",
            None,
        ),
        ("Offer: - Regulator Oxygen", "Regulator Oxygen", None),
        (
            "TINTA PRINTER BROTHER WARNA  CYAN (BT\n5000 C)\nUNTUK PRINTER BRIDGE",
            "TINTA PRINTER BROTHER WARNA CYAN (BT 5000 C)",
            "UNTUK PRINTER BRIDGE",
        ),
        ("Filter oli\nuntuk Yanmar 6N18", "Filter oli", "untuk Yanmar 6N18"),
        (
            "CARBORUNDUM PASTE GRIT#60, COARSE 450GRM For precision lapping, fitting, surfacing,"
            " polishing and other uses in the engine room.",
            "CARBORUNDUM PASTE GRIT#60, COARSE 450GRM",
            None,
        ),
        ("MUR BAUT 620229\nFOR ENGINE STORE", "MUR BAUT 620229", "FOR ENGINE STORE"),
        ("REQUEST HATCH COVER DRAIN VALVE (OVAL)", "HATCH COVER DRAIN VALVE (OVAL)", None),
        (
            "JOINT SHEET EXPANDED GRAPHITE, NOVAPHIT SSTC 1.5X1000X1000MM  The highest quality"
            " gasket material based on pure exfoliated graphite with a stainless steel mesh",
            "JOINT SHEET EXPANDED GRAPHITE, NOVAPHIT SSTC 1.5X1000X1000MM",
            None,
        ),
    ],
)
def test_clean_text_block(raw: str, name: str, description: str | None) -> None:
    c = clean_text_block(raw)
    assert (c.name, c.description) == (name, description)


def test_clean_keeps_request_and_order_notes() -> None:
    c = clean_text_block("Baygon\nREQUEST BAYGON 600 ml\nmin.order 5pcs")
    assert (c.name, c.description, c.note) == ("Baygon", None, "BAYGON 600 ml; min.order 5pcs")
    assert "600" not in comparison_key(c.text)


@pytest.mark.parametrize(
    ("a", "b"),
    [
        ("Filter oli\nuntuk Yanmar 6N18", "Filter oli\nuntuk Daihatsu DK20"),
        ("Kampas rem\nrequest kiri/kanan", "Kampas rem\nrequest kiri"),
        ("Kampas rem\nrequest kiri", "Kampas rem"),
        ("Seal kit\nsesuai contoh A/B", "Seal kit\nsesuai contoh C"),
    ],
)
def test_application_and_request_notes_keep_products_apart(a: str, b: str) -> None:
    cat = build_products([_q("A", _ln(a)), _q("B", _ln(b))])
    assert _item(cat, "A")["id"] != _item(cat, "B")["id"]


def test_rejected_codes_keep_lines_apart() -> None:
    offer = "Gland Packing Carbon Fiber Packing White PTFE Impa {}"
    request = "Non-Asbestos Gland Packing Carbon Fiber Based\nPACKING GLAND NON-AS CARBON, {}"
    lines = [
        _ln(request.format(size), offer=offer.format(text), impa=cell)
        for size, text, cell in (
            ("6.5MM", 810385, 815407),
            ("9.5MM", 810386, 815409),
            ("12.5MM", 810387, 815410),
        )
    ]
    cat = build_products([_q("A", *lines)])
    items = [_item(cat, "A", n) for n in (1, 2, 3)]
    assert len({p["id"] for p in items}) == 3
    assert all(p["impa_code"] is None for p in items)
    assert all("impa_text_differs" in _reasons(cat, p) for p in items)


@pytest.mark.parametrize(
    ("raw", "name", "description", "note"),
    [
        (
            "FLAG SYMBOL (B) size 3' x 4' (only 1 available)",
            "FLAG SYMBOL (B) size 3' x 4'",
            None,
            "only 1 available",
        ),
        (
            "ALLEN WRENCH SETS 2.5MM - 12MM\n5 days",
            "ALLEN WRENCH SETS 2.5MM - 12MM",
            None,
            "5 days",
        ),
        (
            "Galvanized cotter pin 10mm x 200mm\nmade to order: 14 working days",
            "Galvanized cotter pin 10mm x 200mm",
            None,
            "made to order: 14 working days",
        ),
        ("RINSO available 1,2kg", "RINSO", None, "available 1,2kg"),
        (
            "ANTI-SPLASHING TAPE 500MMX10MTR\nOnly 2 pcs available",
            "ANTI-SPLASHING TAPE 500MMX10MTR",
            None,
            "Only 2 pcs available",
        ),
        (
            "Shower Spray THX20MCRB Chrome\n(ready stock)",
            "Shower Spray THX20MCRB Chrome",
            None,
            "ready stock",
        ),
        (
            "Panel Box Outdoor (38 x 20 x 36)\nCustom size - made to order (7 working days)",
            "Panel Box Outdoor (38 x 20 x 36)",
            "Custom size",
            "made to order (7 working days)",
        ),
        (
            "Valve gelas duga\nDelivery time: est 1-2 days\nFranco Bojonegara",
            "Valve gelas duga",
            None,
            "Delivery time: est 1-2 days; Franco Bojonegara",
        ),
        (
            "TINTA PRINTER D6000 (BT D6000 BK\nUNTUK PRINTER BRIDGE, ECR",
            "TINTA PRINTER D6000 (BT D6000 BK",
            "UNTUK PRINTER BRIDGE, ECR",
            None,
        ),
        (
            "Merk Cheetah 3301 H (size 38-44/45) limited stock",
            "Merk Cheetah 3301 H (size 38-44/45)",
            None,
            "limited stock",
        ),
    ],
)
def test_clean_moves_stock_and_order_notes(
    raw: str, name: str, description: str | None, note: str | None
) -> None:
    c = clean_text_block(raw)
    assert (c.name, c.description, c.note) == (name, description, note)


def test_stock_notes_never_block_a_merge() -> None:
    assert (
        _outcome(("Freon R-407A 24LB (only 2 available)", None), ("Freon R-407A 24LB", None))
        == "auto"
    )


def test_clean_moves_pack_notes() -> None:
    c = clean_text_block("Paracetamol Tablet 500 mg\n100s,\n5 pack = 50 tablet")
    assert (c.name, c.description, c.pack_note) == (
        "Paracetamol Tablet 500 mg",
        "100s",
        "5 pack = 50 tablet",
    )
    c = clean_text_block("Kapur Las Size 125 mm x 12 mm x 5 mm 1 Box isi 12 pcs")
    assert (c.name, c.pack_note) == ("Kapur Las Size 125 mm x 12 mm x 5 mm", "1 Box isi 12 pcs")
    c = clean_text_block("DANGER HIGH VOLTAGE(337610) - 30 PCS")
    assert (c.name, c.pack_note) == ("DANGER HIGH VOLTAGE(337610)", "30 PCS")


def test_clean_keeps_impa_group_heading_out_of_the_name() -> None:
    c = clean_text_block("Cable Bands Plastic\nCABLE TIE SELF-LOCKING PLASTIC, 100MM", rfq=True)
    assert (c.name, c.description) == (
        "CABLE TIE SELF-LOCKING PLASTIC, 100MM",
        "Cable Bands Plastic",
    )
    c = clean_text_block("Floatless Level Switch\n61F-GP-N SWITCH", rfq=True)
    assert c.name == "Floatless Level Switch"


# Comparison key


@pytest.mark.parametrize(
    ("a", "b"),
    [
        ("O-Ring JIS B2401 P-80", "Oring JIS B2401 P-80"),
        ("O Ring jis b2401 p-80", "ORING JIS B2401 P-80"),
        ("Selang spiral 2 inch", 'Selang Spiral 2"'),
        ("HOLDER ELECTRODE CLOSED HEAD, 400AMP", "Holder Electrode Closed Head 400A"),
        ("Kawat las 3,2 mm", "kawat las 3.2mm"),
        ("Sapu lantai merk Nagata", "SAPU LANTAI NAGATA"),
        ("Baterry 2800mAh", "Battery 2800 mAh"),
        ("ALUMNIUM FOIL 150 MM X 10 METER", "Aluminum Foil 150mm x 10 meter"),
        ("V-Belt A-42", "Vbelt A-42"),
        ("Vaccum cleaner", "vacuum cleaner"),
        ("Rechargeable Batteray Charger", "Rechargeable Battery Charger"),
    ],
)
def test_comparison_key_normalises(a: str, b: str) -> None:
    assert comparison_key(a) == comparison_key(b)


def test_comparison_key_marks_line_final_plus_and_minus() -> None:
    assert comparison_key("Obeng +") != comparison_key("Obeng -")
    assert comparison_key("Die grinder 6mm - Offer brand") == comparison_key("Die grinder 6mm")


# Guards


@pytest.mark.parametrize(
    ("a", "b", "guard"),
    [
        ("FLAG NATIONAL INDONESIA", "FLAG NATIONAL INDIA", "variant_words"),
        ("INTERNATIONAL FLAG INDIA", "INTERNATIONAL FLAG CHINA", "variant_words"),
        ("Oil Seal Hallite DHS 28", "Oil Seal Hallite UHS 28", "short_tokens"),
        ("O RING G-25", "O RING P-25", "part_numbers"),
        ("Bearing SM SERIES", "Bearing PM SERIES", "short_tokens"),
        ("BATTERY ALKALIN AA", "BATTERY ALKALIN AAA", "variant_words"),
        ("Jas hujan XL", "Jas hujan L", "variant_words"),
        ("RAIN COAT LL", "RAIN COAT L", "variant_words"),
        ("Flash back arrestor Oxygen", "Flash back arrestor LPG", "variant_words"),
        ("plug MALE 4 POLE", "plug FEMALE 4 POLE", "variant_words"),
        ("Tang snap ring external", "Tang snap ring internal", "variant_words"),
        ("Trafo 5000W tanpa box", "Trafo 5000W dengan box", "variant_words"),
        ("Obeng +", "Obeng -", "variant_words"),
        ("Obeng (+) 75 mm Tekiro", "Obeng (-) 75 mm Tekiro", "variant_words"),
        ("OBENG BIASA (-) UKURAN 20 CM", "OBENG BIASA + UKURAN 20 CM", "variant_words"),
        ("Tinta printer HITAM", "Tinta printer MAGENTA", "variant_words"),
        ("NAV LIGHT PORT RED", "NAV LIGHT STB GREEN", "variant_words"),
        ("Gate valve brass 2 in", "Globe valve brass 2 in", "variant_words"),
        ("Kompresor PK-50-160 5HP", "Kompresor PK-50-160 5HP (used)", "variant_words"),
        ("MUR BAUT M16x50", "MUR BAUT M10x50", "numbers"),
        ("Peta Laut No. 314", "Peta Laut No. 315", "numbers"),
        ("Flood Light 150W", "Flood Light 100W", "numbers"),
        ("Cable tie 100mm", "Cable tie 200mm", "numbers"),
        ("Bearing 6N18", "Bearing 6N19", "numbers"),
        ("Seal kit DRC-180B", "Seal kit DRC-180A", "part_numbers"),
        ("Kalibrasi Gas Detector", "Gas Detector Kalibrasi", "item_kind"),
    ],
)
def test_guards_block_real_different_products(a: str, b: str, guard: str) -> None:
    fa = features(clean_text_block(a).text)
    fb = features(clean_text_block(b).text)
    assert blocking_guard(fa, fb) == guard
    assert _outcome((a, None), (b, None)).split(":")[0] != "auto"


def test_guard_impa_codes() -> None:
    f = features("Flange Carbon Steel 1 1/4inc")
    assert blocking_guard(f, f, "735504", "735505") == "impa"
    assert blocking_guard(f, f, "735504", None) is None


def test_guards_pass_spacing_variants() -> None:
    assert blocking_guard(features("RACOR 2040 PM"), features("Racor 2040PM")) is None
    assert (
        blocking_guard(features("O RING NOK C03092-G0"), features("O-RING NOK CO3092-G0")) is None
    )


@pytest.mark.parametrize(
    ("text", "kind"),
    [
        ("Transport to Ternate 24Kg", "service"),
        ("Delivery to Cilegon", "service"),
        ("Kalibrasi\nSingle Gas Detector", "service"),
        ("Jasa pemasangan", "service"),
        ("Service Manuver Panel System", "service"),
        ("Service kit pompa", "product"),
        ("Cargo Hooks with Swivel Hook", "product"),
        ("Packing klingerit 1000, 1mm", "product"),
        ("Paracetamol Tablet 500 mg", "medicine"),
        ("Amoxicillin 500mg", "medicine"),
        ("IMDG CODE SUPPLEMENT ED 2024", "publication"),
        ("Peta Laut Hidros No. 315", "publication"),
        ("Embarkation Ladder 20 Meter Standar SOLAS CCS Certificate", "product"),
        ("Lifebouys weight 2,5 kg (Throw-over Lifebouy) SOLAS Approved", "product"),
        ("RED HAND FLARE MK8 PAINSWESSEX, 9529000 SOLAS/", "product"),
        ("Buku Tulis Folio isi 100 lembar, hard cover", "product"),
        ("Deck Log Book International (English Version)", "publication"),
        ("Buku Tabel Pasang Surut Kepulauan Indonesia 2025", "publication"),
        ("SOLAS CONSOLIDATED 2024", "publication"),
        ("Master Night Order Book", "publication"),
        ("Regulator LPG", "product"),
    ],
)
def test_item_kind(text: str, kind: str) -> None:
    assert item_kind(text) == kind


# Survey clusters: the expected tier for each


@pytest.mark.parametrize(
    ("a", "b", "tier"),
    [
        # 1-3 case only
        (("Starter For FL Lamp FG-1P", None), ("STARTER FOR FL LAMP FG-1P", 791504), "auto"),
        (
            ("Pasta Gigi Pepsodent 225g\nREQUEST PEPSODENT 225ml PER 3 MONTHLY", None),
            ("PASTA GIGI\nPEPSODENT 225g\nREQUEST SIKAT GIGI PER 3 MONTHLY", None),
            "auto",
        ),
        (("- Regulator LPG", None), ("regulator LPG", None), "auto"),
        # 4-9 spacing, hyphens, joined words
        (("Oring JIS B2401 P-80", None), ("O Ring JIS B2401 P-80", None), "auto"),
        (("Oring JIS B2401 P-20", None), ("O Ring JIS B2401 P-20", None), "auto"),
        (
            ("Oring JIS W1517 #5 (90 degree)", None),
            ("O RING JIS W1517 #5 (90 Degree)", None),
            "auto",
        ),
        (("Oring JIS B2401 G-35", None), ("O Ring JIS B2401 G-35", None), "auto"),
        (("RACOR 2040 PM", None), ("Racor 2040PM", None), "review:fuzzy_match"),
        (
            ("ITU MM CD MANUAL FOR MARITIME, MOBILE&MARITIME SATE. SERVICE", None),
            ("ITUMMCD MANUAL FOR MARITIME, MOBILE&MARITIME SATE. SERVICE", 370795),
            "review:fuzzy_match",
        ),
        (("O RING NOK C03092-G0", None), ("O-RING NOK CO3092-G0", None), "review:fuzzy_match"),
        (("SAW DUST 10kgs/bag\nIMPA 232946", None), ("SAWDUST 10 KGS/BAG", 232946), "auto"),
        # 10-16 typos
        (
            ("Baterry Requisition For Grab Bucket", None),
            ("Battery Requisition For Grab Bucket", None),
            "auto",
        ),
        (
            ("Brand My Boring Baterry 2800mAh", None),
            ("Brand My Boring Battery 2800mAh", None),
            "auto",
        ),
        (
            ("Oil Seal Hallite DHS 28", None),
            ("OIL SEAL HILLITE DHS 28", None),
            "review:fuzzy_match",
        ),
        (
            ("Oil Seal Hallite UHS 28", None),
            ("OIL SEAL HILLITE uHS 28", None),
            "review:fuzzy_match",
        ),
        (
            ("Devcon Plastic Steel Putty (A) 10110", None),
            ("Devcon Pastic Steel Putty (A) 10110\n454Gr", None),
            "blocked:numbers",
        ),
        (
            ("Selenoid Valve", None),
            (
                "Solenoid Valve\nwith Coil 19W, Normally Open, Type : 122 K9321, 1/8 Inch, 220V, 60 Hz",
                None,
            ),
            "blocked:numbers",
        ),
        (
            ("ALUMNIUM FOIL TAPE WATER PROOF LAKBAN ANTI BOCOR 150 MM X 10 METER", None),
            ("Aluminum Foil Tape Water Proof \nLakban anti bocor\n150mm x 10 meter", None),
            "auto",
        ),
        (
            ("Electrode Holders 500A IMPA 851034", 851031),
            ("Electrode Holeder 500Amp", 851026),
            "blocked:impa_marks",  # the first line's codes disagree, the second names another
        ),
        # 17-20 word order
        (("Red Flare Hand", None), ("Red Hand Flare", None), "auto"),
        (("Kain Asbes  3mm", None), ("Asbes kain 3mm", None), "auto"),
        (
            ("Pembersih lantai / Vixal", None),
            ("VIXAL PEMBERSIH LANTAI\nREQUEST VIXAL PEMBERSIH LANTAI 800 ml", None),
            "auto",
        ),
        (
            ("Isolasi Listrik Nitto Hitam", None),
            ("ISOLASI HITAM UNTUK LISTRIK \nNitto hitam", None),
            "auto",
        ),
        # 21-23 unit spelling
        (
            ("HOLDER ELECTRODE CLOSED HEAD, 400AMP", None),
            ("Holder Electrode Closed Head 400A", 851025),
            "auto",
        ),
        (("Selang spiral 2 inch", None), ('Selang Spiral 2"', None), "auto"),
        (
            ("Paracetamol Tablet 500 mg\n100s, \n5 pack = 50 tablet", None),
            ("PARACETAMOL TABLET 500MG", None),
            "blocked:numbers",
        ),
        # 24-26 brand added or dropped
        (
            ("Sapu lantai plastik long handle", None),
            ("Sapu lantai plastik long handle, Merk Nagata", None),
            "separate",  # token_sort 89.9: below the candidate bar
        ),
        (
            ("PUMA Kompresor Angin Otomatis PK-50-160 5HP 8 BAR 440V, 60Hz", None),
            ("Kompresor Angin Otomatis PK-50-160 5HP 8 BAR 440V, 60Hz", None),
            "review:fuzzy_match",
        ),
        (
            ("PUMA Kompresor Angin Otomatis PK-50-160 5HP 8 BAR 440V, 60Hz", None),
            ("PUMA Kompresor Angin Otomatis PK-50-160 5HP 8 BAR 440V, 60Hz (used)", None),
            "blocked:variant_words",
        ),
        (
            ("contact cleaner", None),
            ("Contact Cleaner \nRexco 18 500ML", 795511),
            "blocked:numbers",
        ),
        # 27-30 notes appended to the name
        (("Dust Seal 20x26x3,6mm", None), ("Dust Seal 20x26x3,6mm\nmin.order 5pcs", None), "auto"),
        (
            ("Power Supply UPS Meanwell DRC-180B Meanwell", None),
            ("Power Supply UPS Meanwell DRC-180B Meanwell\nNOTE: PRE-ORDER 21 days", None),
            "auto",
        ),
        (
            ("Pneumatic Die grinders, collect chuck size: 6mm\xa0\xa0- Offer brand", None),
            ("Pneumatic Die grinders, collect chuck size: 6mm", None),
            "auto",
        ),
        (("Baygon", None), ("Baygon\nREQUEST BAYGON 600 ml", None), "auto"),
        (("TISSUE FACIAL", 391491), ("TISSUE FACIAL\n350 SHEET - 2 DOZ", None), "blocked:numbers"),
    ],
)
def test_survey_clusters(a: tuple[str, object], b: tuple[str, object], tier: str) -> None:
    assert _outcome(a, b) == tier


@pytest.mark.parametrize(
    ("a", "b"),
    [
        ("BOLT AND NUT M20x50", "STUD BOLD AND NUT M20x50"),
        ("Buku Tabel Pasang Surut", "Buku Tabel Pasang Arus Surut"),
        (
            "Transport to Manado - Cylinder Head Yanmar 6N18 (L) - HV",
            "Transport to Ternate - Cylinder Head Yanmar 6N18 (L) - HV",
        ),
        (
            "Cable Bands Plastic\nCABLE TIE SELF-LOCKING PLASTIC, 100MM",
            "Cable Bands Plastic\nCABLE TIE SELF-LOCKING PLASTIC, 200MM",
        ),
    ],
)
def test_look_alikes_never_auto_merge(a: str, b: str) -> None:
    assert _outcome((a, None), (b, None)) != "auto"


# IMPA


def test_same_name_under_two_codes_stays_apart_and_is_reviewed() -> None:
    cat = build_products(
        [
            _q("A", _ln("Flange Carbon Steel 1 1/4inc", impa=735504)),
            _q("B", _ln("Flange Carbon Steel 1 1/4inc", impa=735505)),
            _q("C", _ln("Flange carbon steel 1 1/4 inc")),
        ]
    )
    a, b, c = _item(cat, "A"), _item(cat, "B"), _item(cat, "C")
    assert a["id"] != b["id"]
    assert c["id"] in (a["id"], b["id"])
    assert "same_name_different_impa" in _reasons(cat, a)
    assert cat.stats["impa_codes_valid"] == 2


def test_one_code_with_different_products_splits() -> None:
    tape = "SOUNDING TAPE FOR WATER (30 M)"
    cat = build_products(
        [
            _q("A", _ln(tape, impa=650874), _ln("Meteran 10M, Brand: Tekiro", impa=650874)),
            _q("B", _ln(tape, offer="Impa 650874 (30m)", impa=650874)),
            _q("C", _ln("Resistance bulb termocouple, RTD PT-100", impa=650874)),
        ]
    )
    main = _item(cat, "A", 1)
    assert main["impa_code"] == "650874"
    assert _item(cat, "B")["id"] == main["id"]
    assert main["name"] == tape
    meter, rtd = _item(cat, "A", 2), _item(cat, "C")
    assert len({main["id"], meter["id"], rtd["id"]}) == 3
    assert meter["impa_code"] is None and meter["rejected_impa"] == ["650874"]
    assert "impa_split" in _reasons(cat, meter)
    assert "impa_split" in _reasons(cat, rtd)
    assert cat.stats["impa_codes_conflicting"] == 1


@pytest.mark.parametrize(
    ("line", "code", "issue"),
    [
        (_ln("Bolt M10", impa=691185), "691185", None),
        (_ln("Starter FG-1P IMPA 791504"), "791504", None),
        (_ln("Electrode Holders 500A IMPA 851034", impa=851031), None, "impa_text_differs"),
        (_ln("Pipe 2 in", impa="#REF!"), None, "impa_invalid"),
        (_ln("Lampu", impa="3-5W 24VDC"), None, "impa_invalid"),
        (_ln("Mur baut", impa=620229), None, "impa_invalid"),
        (_ln("DANGER HIGH VOLTAGE(337610) - 30 PCS"), None, "impa_unconfirmed_in_text"),
        (_ln("Lampu", impa="0"), None, None),
        (_ln("Lampu", impa="-"), None, None),
    ],
)
def test_line_impa(line: Record, code: str | None, issue: str | None) -> None:
    got = line_impa(line)
    assert got.code == code
    assert ([i.reason for i in got.issues] or [None])[0] == issue


def test_line_impa_marks_the_codes_it_rejects() -> None:
    assert line_impa(_ln("Holder 500A IMPA 851034", impa=851031)).marks == frozenset(
        {"851031", "851034"}
    )
    assert line_impa(_ln("Bolt M10", impa=691185)).marks == frozenset()


def test_invalid_code_never_joins_products() -> None:
    cat = build_products(
        [
            _q("A", _ln("Pipe carbon 2 in", impa="#REF!")),
            _q("B", _ln("Speed sensor SP-124", impa="#REF!")),
        ]
    )
    a, b = _item(cat, "A"), _item(cat, "B")
    assert a["id"] != b["id"] and a["impa_code"] is None
    row = next(r for r in cat.review if r["reason"] == "impa_invalid" and r["item_id"] == a["id"])
    assert "#REF!" in row["detail"]
    assert cat.stats["impa_values_invalid"] == 1


# Name source, units and output


def test_name_comes_from_offer_unless_it_is_a_note() -> None:
    cat = build_products(
        [
            _q(
                "A",
                _ln("Kawat las", offer="Kawat las RB26 2.6mm"),
                _ln(
                    "SCREWDRIVER PLASTIC HANDLE (- SLOTTED SCREWDRIVER) BLADE LENGTH 150 MM",
                    offer="Brand Tekiro 8x150mm",
                ),
                _ln("SLIDING T HANDLE 19MM", offer="No Offer"),
            )
        ]
    )
    assert _item(cat, "A", 1)["name"] == "Kawat las RB26 2.6mm"
    sd = _item(cat, "A", 2)
    assert sd["name"] == "SCREWDRIVER PLASTIC HANDLE (- SLOTTED SCREWDRIVER) BLADE LENGTH 150 MM"
    assert sd["description"] == "Brand Tekiro 8x150mm"
    assert _item(cat, "A", 3)["name"] == "SLIDING T HANDLE 19MM"


def test_units_default_to_the_most_used() -> None:
    cat = build_products(
        [
            _q("A", _ln("Gland packing 10mm", unit="Pcs"), _ln("Gland packing 10mm", unit="roll")),
            _q("B", _ln("Gland packing 10mm", unit="pc")),
            _q(
                "C",
                _ln("Kain majun", unit="karung"),
                _ln("Seal tape", unit="xyz"),
                _ln("Rope 10mm", unit=None),
            ),
        ]
    )
    gp = _item(cat, "A")
    assert (gp["default_unit"], gp["units"]) == ("PCS", {"PCS": 2, "RLS": 1})
    assert "mixed_units" in _reasons(cat, gp)
    assert _item(cat, "C", 1)["default_unit"] == "OTH"
    assert "unit_unmapped" in _reasons(cat, _item(cat, "C", 2))
    rope = _item(cat, "C", 3)
    assert rope["default_unit"] is None and "no_unit" in _reasons(cat, rope)


def test_products_output_shape_and_counts() -> None:
    cat = build_products(
        [
            _q("A", _ln("Red Flare Hand", impa=330160), _ln("Battery AA")),
            _q("B", _ln("Red Hand Flare"), _ln("Battery AAA")),
        ]
    )
    flare = _item(cat, "A", 1)
    assert flare["impa_code"] == "330160"
    assert flare["merged_from"] == ["Red Hand Flare"]
    assert flare["source_lines"] == [
        {"quotation": "A", "line_no": 1},
        {"quotation": "B", "line_no": 1},
    ]
    assert all(re.fullmatch(r"P[0-9a-f]{10}", p["id"]) for p in cat.products)
    assert [p["name"] for p in cat.products] == ["Battery AA", "Battery AAA", "Red Flare Hand"]
    s = cat.stats
    assert (s["lines"], s["raw_distinct_names"], s["canonical_items"], s["auto_merges"]) == (
        4,
        4,
        3,
        1,
    )


def test_one_code_never_overrides_a_guard() -> None:
    bolt = "HEX HEAD BOLT/NUT STEEL UNGALV, M12 X 65MM"
    tape = "Vinyl Electrical Tape 19mm x 20m"
    rope = "Rope PP 8 Strand CIR"
    cat = build_products(
        [
            _q("A", _ln(bolt, impa=691225), _ln(f"{tape}, Black", impa=795431)),
            _q("B", _ln(bolt, offer=f"{bolt}\nBlack steel, full drat", impa=691225)),
            _q("C", _ln(f"{tape}, Blue", impa=795431)),
            _q("D", _ln(f"{rope} 10", impa=210318), _ln(f"{rope} 12", impa=210318)),
            _q("E", _ln("Vacuum cleaner 30L", impa=174311)),
            _q("F", _ln("Vacuum cleaner 60L", impa=174311)),
            _q("G", _ln("Broom coir", impa=510801)),
            _q("H", _ln("Broom plastic soft", impa=510801)),
        ]
    )
    plain, black = _item(cat, "A", 1), _item(cat, "B")
    assert plain["id"] != black["id"]
    assert plain["impa_code"] == "691225" and black["rejected_impa"] == ["691225"]
    assert "impa_split" in _reasons(cat, black)
    assert _item(cat, "A", 2)["id"] != _item(cat, "C")["id"]
    ten, twelve = _item(cat, "D", 1), _item(cat, "D", 2)
    assert ten["id"] != twelve["id"]
    assert "impa_split" in _reasons(cat, ten) and "impa_split" in _reasons(cat, twelve)
    assert _item(cat, "E")["id"] != _item(cat, "F")["id"]
    assert _item(cat, "G")["id"] != _item(cat, "H")["id"]


@pytest.mark.parametrize(
    "texts",
    [
        ["HAND SNAP\nKAIN PEL", "HAND SNAP\nSAPU IJUK", "HAND SNAP\nSEROK SAMPAH"],
        ['HOSE BAND GALV STEEL 8-14MM\nclamp 1/4"', 'HOSE BAND GALV STEEL 8-14MM\nclamp 1/2"'],
        ["HEX HEAD BOLT M8", "HEX HEAD BOLT M10", "HEX HEAD BOLT M12"],
        ["Precision try square", "Precision try square with blade"],
    ],
)
def test_one_quotation_never_merges_its_own_different_lines(texts: list[str]) -> None:
    cat = build_products([_q("A", *(_ln(t, impa=174265) for t in texts))])
    ids = {_item(cat, "A", n)["id"] for n in range(1, len(texts) + 1)}
    assert len(ids) == len(texts)
    assert not [r for r in cat.review if r["reason"] == "fuzzy_match"]


def test_one_quotation_repeating_a_line_is_one_product() -> None:
    cat = build_products([_q("A", _ln("Kain majun putih"), _ln("KAIN MAJUN PUTIH"))])
    assert _item(cat, "A", 1)["id"] == _item(cat, "A", 2)["id"]


def test_a_code_merge_of_different_texts_is_reviewed() -> None:
    cat = build_products(
        [
            _q("A", _ln("Measuring tape steel 30m", impa=650874)),
            _q("B", _ln("Steel measuring tape 30m long", impa=650874)),
        ]
    )
    a = _item(cat, "A")
    assert a["id"] == _item(cat, "B")["id"] and a["impa_code"] == "650874"
    (row,) = [r for r in cat.review if r["reason"] == "merged_texts_differ"]
    assert "Steel measuring tape 30m long" in row["detail"]


@pytest.mark.parametrize(
    ("a", "b", "guard"),
    [
        (
            "Merk Yean, Type DFY-I (Certificate)",
            "Merk Yean, Type DFY-II (Certificate)",
            "short_tokens",
        ),
        ("Pompa 15.000 l/h", "Pompa 15 l/h", "numbers"),
    ],
)
def test_guards_on_suffixes_and_thousands(a: str, b: str, guard: str) -> None:
    fa, fb = features(clean_text_block(a).text), features(clean_text_block(b).text)
    assert blocking_guard(fa, fb) == guard


def test_removed_impa_mention_leaves_no_sign() -> None:
    c = clean_text_block("LEVER TYPE HAND GREASE GUNS - IMPA 617703")
    assert c.name == "LEVER TYPE HAND GREASE GUNS"
    assert "minus" not in comparison_key(c.text)


def test_line_source_skips_an_offer_without_text() -> None:
    assert line_source(_ln("SKR GREASE HOSE 1/4in 10MTRS", offer="?")).text == (
        "SKR GREASE HOSE 1/4in 10MTRS"
    )


@pytest.mark.parametrize(
    ("request_text", "offer", "name", "description", "note"),
    [
        (
            "MUR BAUT MASA & STAILESS 610267\nFOR ENGINE STORE",
            "please provide details",
            "MUR BAUT MASA & STAILESS 610267",
            "FOR ENGINE STORE",
            "please provide details",
        ),
        (
            "TRANSFORMER PRIMER 440 VOLT SECUNDER 220 VOLT ENGINE ROOM",
            "To be Confirm",
            "TRANSFORMER PRIMER 440 VOLT SECUNDER 220 VOLT ENGINE ROOM",
            None,
            "To be Confirm",
        ),
        (
            "VENTILATION TUBES 10 M",
            '591486 (12" , 10M)',
            "VENTILATION TUBES 10 M",
            '(12" , 10M)',
            None,
        ),
        (
            "Corrugated cardboard 1x1m, ketebalan +- 2mm (mesti bersih dan baru) 7000m2",
            "DOUBLE WALL",
            "Corrugated cardboard 1x1m, ketebalan +- 2mm (mesti bersih dan baru) 7000m2",
            "DOUBLE WALL",
            None,
        ),
        (
            "CARBORUNDUM PASTE GRIT#60, COARSE 450GRM  For precision lapping, fitting, surfacing.",
            "CAM Grit60",
            "CARBORUNDUM PASTE GRIT#60, COARSE 450GRM",
            "CAM Grit60",
            None,
        ),
        ("SAWDUST APP 10KG", "Serbuk kayu 10KG", "Serbuk kayu 10KG", None, None),
        ("Kabel ties 300mm hitam", "Kabel Ties 300mm", "Kabel Ties 300mm", None, None),
    ],
)
def test_placeholder_and_fragment_offers_fall_back_to_the_request(
    request_text: str, offer: str, name: str, description: str | None, note: str | None
) -> None:
    cat = build_products([_q("A", _ln(request_text, offer=offer))])
    item = _item(cat, "A")
    assert (item["name"], item["description"], item["notes"]) == (name, description, note)


def test_a_pack_fragment_offer_is_a_pack_note() -> None:
    cat = build_products(
        [_q("A", _ln("ACETYLSALICYLIC ACID, 300 mg TABLETS", offer="1 Strip 4 tablet"))]
    )
    item = _item(cat, "A")
    assert (item["name"], item["pack_note"]) == (
        "ACETYLSALICYLIC ACID, 300 mg TABLETS",
        "1 Strip 4 tablet",
    )


def test_an_rfq_heading_leads_only_when_the_offer_keeps_it() -> None:
    request = "Foil Wrapping\nWRAPPING FOIL CELLOPHANE, 300MMX50MTR"
    bolt = (
        "Ungalvanized Steel Hexagon Head Bolts and Nuts\nHEX HEAD BOLT/NUT STEEL UNGALV, M8 X 30MM"
    )
    cat = build_products(
        [
            _q(
                "A",
                _ln(
                    request,
                    offer="Foil Wrapping - Plastic Cling Wrap Food Grade\n"
                    "WRAPPING FOIL CELLOPHANE, 300MMX50MTR",
                    impa=174207,
                ),
                _ln(bolt, offer=bolt, impa=691141),
            )
        ]
    )
    assert _item(cat, "A", 1)["name"] == "Foil Wrapping - Plastic Cling Wrap Food Grade"
    assert _item(cat, "A", 2)["name"] == "HEX HEAD BOLT/NUT STEEL UNGALV, M8 X 30MM"


def test_single_word_names_are_reviewed() -> None:
    cat = build_products([_q("A", _ln("Spindle"), _ln("Baygon 600 ml"))])
    assert "generic_name" in _reasons(cat, _item(cat, "A", 1))
    assert "generic_name" not in _reasons(cat, _item(cat, "A", 2))


def test_lines_split_off_a_code_are_not_merged_by_it() -> None:
    brush = _ln("Wire cup brush 100mm", impa=510767)
    cat = build_products(
        [
            _q("A", brush, brush, brush),
            _q("B", _ln('Hose band stainless steel 2" (27-51mm)', impa=510767)),
            _q("C", _ln('Hose Bands CLAMP 1/2"', impa=510767)),
        ]
    )
    assert _item(cat, "A")["impa_code"] == "510767"
    assert _item(cat, "B")["id"] != _item(cat, "C")["id"]


def test_a_checked_code_stays_with_the_product_it_names() -> None:
    cat = build_products(
        [
            _q("A", _ln("SOUNDING TAPE FOR WATER (30 M)", impa=650878)),
            _q("B", _ln("Meteran 10M, Brand: Tekiro", impa=650878)),
        ]
    )
    tape, meter = _item(cat, "A"), _item(cat, "B")
    assert tape["impa_code"] == "650878"
    assert meter["impa_code"] is None and meter["rejected_impa"] == ["650878"]
    assert "impa_suspect" in _reasons(cat, meter)


@pytest.mark.parametrize(
    ("text", "code", "kept"),
    [
        ("Cable NYYHY 3x1,5mm", 794283, False),
        ("CABLE HALOGEN-FREE UNARMOURED, HF-CXO 0.6/1KV 1.5MM2X3C 16AMP", 794283, True),
        ("Amplas Roll 50mm x 45m Grid #120", 614731, False),
        ("Shacke D Galvanized 22 mm", 233843, False),
        ("Plastic Broom/Sapu plastik", 510801, False),
        ("BROOM CORN", 510801, True),
        ("Welding Rod LB-52U KOBE, Diam.3,2mm", 614054, False),
        ("Kain Majun putih", 851116, False),
        ("Bolt & Nut M20 x 50 Carbon Steel", 110125, False),
        ("Baut M10 x 30", 612345, False),
        ("HEX HEAD BOLT/NUT STEEL UNGALV, M8 X 30MM", 691141, True),
        ("Kawat las RB-26 3,2mm", 614054, False),
        ("Kawat las RB-26 3,2mm", 851328, True),
        ("Shackle D type 16mm", 232191, True),
        ("Nut driver set 5-12mm", 612366, True),
    ],
)
def test_survey_and_section_checks(text: str, code: int, kept: bool) -> None:
    cat = build_products([_q("A", _ln(text, impa=code))])
    item = _item(cat, "A")
    assert (item["impa_code"] == str(code)) is kept
    assert ("impa_suspect" in _reasons(cat, item)) is not kept


def test_identical_keys_merge_past_a_blocked_first_member() -> None:
    cat = build_products(
        [
            _q("A", _ln("Biaya kirim paket")),
            _q("B", _ln("Kirim paket biaya")),
            _q("C", _ln("Paket kirim biaya")),
        ]
    )
    service, b, c = _item(cat, "A"), _item(cat, "B"), _item(cat, "C")
    assert service["kind"] == "service" and service["id"] != b["id"]
    assert b["id"] == c["id"]


def _sheet(lines: list[tuple[str, object, str | None]]) -> dict[str, object]:
    cells: dict[str, object] = {
        "A2": "Customer", "D2": "PT Kemala Shipping", "A3": "No", "D3": "Q-968300/GNS/VI/2026",
        "A4": "Date", "D4": "Jakarta, 05 Juni 2026",
        "A11": "No.", "B11": "Qty", "C11": "Unit", "D11": "Request", "E11": "IMPA",
        "F11": "Offer", "G11": "JUAL", "I11": "MODAL",
    }  # fmt: skip
    for n, (request, impa, offer) in enumerate(lines, start=1):
        row = 12 + n
        cells.update({f"A{row}": n, f"B{row}": 1, f"C{row}": "Pcs", f"D{row}": request})
        cells.update({f"E{row}": impa, f"F{row}": offer, f"G{row}": 1000, f"I{row}": 500})
    return cells


def test_synthetic_workbooks_to_products(tmp_path: Path) -> None:
    folder = tmp_path / "Quotation 2026 - Excel"
    first = [("Oring JIS B2401 P-80", None, None), ("Oil Seal Hallite DHS 28", None, None)]
    second = [
        ("O Ring JIS B2401 P-80", None, None),
        ("Oil Seal Hallite UHS 28", None, None),
        ("Sounding tape", 650878, "SOUNDING TAPE FOR WATER (30 M)"),
    ]
    a = save_workbook(
        folder / "Q-968300 (Seals) - Kemala Shipping.xlsx", {"DATA ENTRI": _sheet(first)}
    )
    b = save_workbook(
        folder / "Q-968301 (Seals) - Kemala Shipping.xlsx", {"DATA ENTRI": _sheet(second)}
    )
    records = [r for path in (a, b) for r in build_workbook(path, tmp_path)[0]]
    cat = build_products(records)
    ida, idb = (f"Quotation 2026 - Excel/{p.name}#DATA ENTRI" for p in (a, b))
    assert _item(cat, ida, 1)["id"] == _item(cat, idb, 1)["id"]
    assert _item(cat, ida, 2)["id"] != _item(cat, idb, 2)["id"]
    tape = _item(cat, idb, 3)
    assert (tape["name"], tape["impa_code"]) == ("SOUNDING TAPE FOR WATER (30 M)", "650878")
    assert cat.stats["lines"] == 5


# Review sheet and overrides


def test_item_ids_survive_unrelated_input() -> None:
    base = [_q("A", _ln("Red Flare Hand"), _ln("Battery AA")), _q("B", _ln("Red Hand Flare"))]
    first = build_products(base)
    second = build_products([_q("0", _ln("Anchor chain 16mm")), *base])
    assert _item(first, "A", 1)["id"] == _item(second, "A", 1)["id"]
    assert _item(first, "A", 2)["id"] == _item(second, "A", 2)["id"]


def test_review_rows_show_source_lines_and_text() -> None:
    cat = build_products(
        [_q("A", _ln("Oil Seal Hallite DHS 28")), _q("B", _ln("OIL SEAL HILLITE DHS 28"))]
    )
    (row,) = [r for r in cat.review if r["reason"] == "fuzzy_match"]
    assert {row["text"], row["other_text"]} == {
        "Oil Seal Hallite DHS 28",
        "OIL SEAL HILLITE DHS 28",
    }
    assert {json.dumps(row["lines"]), json.dumps(row["other_lines"])} == {
        '[["A", 1]]',
        '[["B", 1]]',
    }
    assert "hallite" not in row["detail"] and row["decision"] == ""


def _hallite(overrides: list[dict[str, object]]) -> Catalog:
    return build_products(
        [
            _q("A", _ln("Oil Seal Hallite DHS 28"), _ln("Kain majun")),
            _q("B", _ln("OIL SEAL HILLITE DHS 28"), _ln("Kain majun")),
            _q("C", _ln("Sounding tape 30m")),
        ],
        overrides,
    )


def test_overrides_merge_split_set_impa_and_rename() -> None:
    cat = _hallite(
        [
            {"action": "merge", "lines": [["A", 1], ["B", 1]]},
            {"action": "split", "lines": [["B", 2]]},
            {"action": "set_impa", "lines": [["C", 1]], "impa": "650878"},
            {"action": "rename", "lines": [["A", 1]], "name": "Oil Seal Hallite DHS 28x38"},
        ]
    )
    seal = _item(cat, "A", 1)
    assert _item(cat, "B", 1)["id"] == seal["id"]
    assert seal["name"] == "Oil Seal Hallite DHS 28x38"
    assert _item(cat, "A", 2)["id"] != _item(cat, "B", 2)["id"]
    assert _item(cat, "C")["impa_code"] == "650878"
    assert not [r for r in cat.review if r["reason"] == "fuzzy_match"]


def test_a_decided_review_row_says_so() -> None:
    cat = _hallite([{"action": "split", "lines": [["B", 2]]}])
    (row,) = [r for r in cat.review if r["reason"] == "fuzzy_match"]
    assert row["decision"] == ""
    cat = _hallite([{"action": "set_impa", "lines": [["A", 1]], "impa": None}])
    (row,) = [r for r in cat.review if r["reason"] == "fuzzy_match"]
    assert row["decision"] == "override 1: set_impa"


@pytest.mark.parametrize(
    "override",
    [
        {"action": "merge", "lines": [["Z", 9], ["A", 1]]},
        {"action": "set_impa", "lines": [["C", 1]], "impa": "123"},
        {"action": "explode", "lines": [["A", 1]]},
    ],
)
def test_a_stale_or_bad_override_is_reviewed(override: dict[str, object]) -> None:
    cat = _hallite([override])
    assert [r["reason"] for r in cat.review if r["reason"].startswith("override")] == [
        "override_invalid"
    ]
