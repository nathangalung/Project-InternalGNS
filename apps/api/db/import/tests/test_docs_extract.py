"""Unit tests for the source document readers."""

from datetime import date
from decimal import Decimal

import pytest
from openpyxl import Workbook

from docs_extract import (
    parse_id_date,
    parse_pelita_order,
    read_do_sheet,
    read_invoice,
    read_quote,
)

PELITA_TEXT = """\
                                        Order
                                        Reference No. / Case ID              V-96-9405-063-E/02/01
                                        Order Date                                    Jan 20, 2026

PT Pelita Global Logistik                PT Global Niaga Sakti
Vessel:                                  Product:
Name:                      DAIDAN PERTIWI               Category:   IMPA marine stores guide
Order Details:                                          Order Terms:
Ref. No.:                  V-96-9405-063-E/02/01        Delivery Term:   DT not selected
Order No.:                                              Country, City:   Indonesia, SMI Cilegon
RFQ Date:                  15-Jan-2026                  Delivery Date:   3 days
Offer No.:                 Q-962031/GNS/I/2026          Payment Terms:   30 days
                                        Price Summary:
                                        Price:                                  64,200,000.00       IDR
                                        Rebate [%]:               5.00%          3,210,000.00       IDR
                                        Price After Rebate:                     60,990,000.00       IDR
                                        Transport:                                       0.00       IDR
                                        Boat charges                             1,500,000.00       IDR
                                        Sub Total:                              62,490,000.00       IDR
                                        VAT [%]:                  11%            6,873,900.00       IDR
                                        Total:                                  69,363,900.00       IDR
                                                                                          1 / 2
                                        Order
Position   Description                                      Code No.        Qty. ordered            IDR/Unit   [%]           Total IDR
001        Marine Bronze 16kgf/cm2 F-7303/F-7304            750153                 1 pcs    4,300,000.0000            4,300,000.0000
           ANGLE VALVE BRONZE FLANGED-END,                  75
           F7304 16KG-25MM                                  Valves & Cocks
                                                            PCS
           Purchaser:    ANGLE VALVE NR 16K 25
                         OD Valve             : 125 mm
           Supplier:     Offered: F-7304 bronze

002        Stainless Steel Hexagon Head Bolts and Nuts 692931                 2 pcs    7,750,000.0000   0.00    15,500,000.0000
           HEX HEAD BOLT/NUT STAINLESS, STEEL 69
           M16 X 100MM                                 Screws & Nuts
003        Tees Male Run Stainless Steel Flareless       734352               10 pcs         0.0000                   0.0000
                                                                                          2 / 2
Position   Description                                      Code No.        Qty. ordered            IDR/Unit   [%]           Total IDR
004        Cardboard                              Cardboard                  6500 pcs       10,800.0000      70,200,000.0000
"""


def test_parse_id_date_variants() -> None:
    assert parse_id_date("Tanggal:        08 Januari 2026") == date(2026, 1, 8)
    assert parse_id_date("12 January 2026") == date(2026, 1, 12)
    assert parse_id_date("Jan 20, 2026") == date(2026, 1, 20)
    assert parse_id_date("20-Feb-2026") == date(2026, 2, 20)
    assert parse_id_date("2026/02/03") == date(2026, 2, 3)
    assert parse_id_date("08 Februari 2025") == date(2025, 2, 8)
    assert parse_id_date("Jakarta, 29 December2025") == date(2025, 12, 29)
    assert parse_id_date("no date here") is None


def test_parse_pelita_order_header_and_summary() -> None:
    order = parse_pelita_order(PELITA_TEXT)
    assert order.ref_no == "V-96-9405-063-E/02/01"
    assert order.order_date == date(2026, 1, 20)
    assert order.vessel == "DAIDAN PERTIWI"
    assert order.offer_no == "Q-962031/GNS/I/2026"
    assert order.order_no is None
    assert order.city == "Indonesia, SMI Cilegon"
    assert order.payment_terms == "30 days"
    assert order.rfq_date == date(2026, 1, 15)
    assert order.price == Decimal("64200000.00")
    assert order.rebate_pct == Decimal("5.00")
    assert order.rebate == Decimal("3210000.00")
    assert order.charges == [("Boat charges", Decimal("1500000.00"))]
    assert order.sub_total == Decimal("62490000.00")
    assert order.vat_pct == Decimal("11")
    assert order.vat == Decimal("6873900.00")
    assert order.total == Decimal("69363900.00")


def test_parse_pelita_order_lines_across_pages() -> None:
    lines = parse_pelita_order(PELITA_TEXT).lines
    assert [ln.position for ln in lines] == [1, 2, 3, 4]
    first = lines[0]
    assert first.code == "750153"
    assert first.description == (
        "Marine Bronze 16kgf/cm2 F-7303/F-7304\nANGLE VALVE BRONZE FLANGED-END,\nF7304 16KG-25MM"
    )
    assert (first.qty, first.unit, first.unit_price, first.amount) == (
        Decimal("1"),
        "pcs",
        Decimal("4300000"),
        Decimal("4300000"),
    )
    assert first.remark == "ANGLE VALVE NR 16K 25\nOD Valve             : 125 mm"
    assert first.supplier_remark == "Offered: F-7304 bronze"
    # The group number 69 runs into the description column
    assert lines[1].description == (
        "Stainless Steel Hexagon Head Bolts and Nuts\nHEX HEAD BOLT/NUT STAINLESS, STEEL\n"
        "M16 X 100MM"
    )
    assert lines[1].code == "692931"
    assert lines[1].remark is None
    assert lines[2].unit_price == Decimal("0")
    assert lines[3].code == "Cardboard"
    assert lines[3].qty == Decimal("6500")


def _layout_b() -> tuple[Workbook, Workbook]:
    values, formulas = Workbook(), Workbook()
    for wb in (values, formulas):
        do = wb.active
        do.title = "DO"
        do["J1"] = date(2026, 1, 26)
        do["D9"] = "PT KARUNIA AMAN SENTOSA"
        do["I9"] = "916/DO-GNS/I/2026"
        do["J11"] = "JKT-PO/905.905/OFFICE/0126"
        do["J12"] = date(2026, 1, 13)
        do["C15"] = 3
        do["D15"] = "     Pcs"
        do["E15"] = "Relay Schneider RXM4AB2P7"
        do["C16"] = 1
        do["D16"] = "Set"
        do["E16"] = "Socket"
        wb.create_sheet("Invoice")
    inv_v, inv_f = values["Invoice"], formulas["Invoice"]
    cells: dict[str, tuple[object, object]] = {
        "I1": (date(2025, 1, 26), date(2025, 1, 26)),
        "I5": ("No. 916/INV-GNS/I/2026", "No. 916/INV-GNS/I/2026"),
        "D8": ("PT KARUNIA AMAN SENTOSA", "=DO!D9"),
        "J8": ("JKT-PO/905.905/OFFICE/0126", "=DO!J11"),
        "J9": (date(2026, 1, 13), "=DO!J12"),
        "J10": ("916/DO-GNS/I/2026", "=DO!I9"),
        "J11": (date(2025, 2, 25), "=I1+30"),
        "B14": (3, "=DO!C15"),
        "C14": ("Relay Schneider RXM4AB2P7", "=DO!E15"),
        "I14": (145000, 145000),
        "J14": (435000, "=I14*B14"),
        "B15": (1, "=DO!C16"),
        "C15": ("Socket", "=DO!E16"),
        "I15": (50000, 50000),
        "J15": (50000, "=I15*B15"),
        "J18": (485000, "=SUM(J14:J16)"),
        "J19": (-24250, "=-J18*5%"),
        "J20": (50682.5, "=((J18+J19)*11%)"),
        "J21": (511432.5, "=SUM(J18:J20)"),
    }
    for ref, (val, form) in cells.items():
        inv_v[ref] = val
        inv_f[ref] = form
    return values, formulas


def test_read_invoice_layout_b() -> None:
    doc = read_invoice(*_layout_b())
    assert doc.invoice_numbers == ["916/INV-GNS/I/2026"]
    assert doc.do_numbers == ["916/DO-GNS/I/2026"]
    assert doc.invoice_date == date(2025, 1, 26)
    assert doc.due_date == date(2025, 2, 25)
    assert doc.po_number == "JKT-PO/905.905/OFFICE/0126"
    assert doc.po_date == date(2026, 1, 13)
    assert doc.do_date == date(2026, 1, 26)
    assert doc.client == "PT KARUNIA AMAN SENTOSA"
    assert [(ln.qty, ln.unit, ln.unit_price, ln.amount) for ln in doc.lines] == [
        (Decimal("3"), "Pcs", Decimal("145000"), Decimal("435000")),
        (Decimal("1"), "Set", Decimal("50000"), Decimal("50000")),
    ]
    assert doc.lines[0].description == "Relay Schneider RXM4AB2P7"
    assert doc.subtotal == Decimal("485000")
    assert doc.discount == Decimal("24250")
    assert doc.ppn == Decimal("50682.5")
    assert doc.total == Decimal("511432.5")
    assert doc.ppn_rate == Decimal("11")


def test_read_invoice_positive_discount_and_zero_vat() -> None:
    values, formulas = _layout_b()
    for wb in (values, formulas):
        wb["Invoice"]["J19"] = 24250
        wb["Invoice"]["J20"] = 0
        wb["Invoice"]["J21"] = 460750
    formulas["Invoice"]["J20"] = "=((J18+J19)*11%)*0"
    doc = read_invoice(values, formulas)
    assert doc.discount == Decimal("24250")
    assert doc.ppn == Decimal("0")
    assert doc.ppn_rate == Decimal("0")
    assert doc.total == Decimal("460750")


def test_read_invoice_ignores_po_numbers_in_line_text() -> None:
    values, formulas = _layout_b()
    for wb in (values, formulas):
        wb["DO"]["J11"] = None
        wb["Invoice"]["J8"] = None
        wb["Invoice"]["J9"] = None
    values["Invoice"]["C14"] = "Pengiriman item PO-TCP/XII/2025-90540 ke Sangatta"
    doc = read_invoice(values, formulas)
    assert doc.po_number is None
    assert doc.po_date is None
    assert doc.lines[0].description == "Pengiriman item PO-TCP/XII/2025-90540 ke Sangatta"


def test_read_do_sheet() -> None:
    values, _ = _layout_b()
    assert read_do_sheet(values) == (["916/DO-GNS/I/2026"], date(2026, 1, 26))
    values["DO"]["J1"] = None
    values["DO"]["I9"] = "No. 023B/DO-GNS/II/2026"
    values["DO"]["I8"] = "Tanggal: 20 February 2026"
    assert read_do_sheet(values) == (["023B/DO-GNS/II/2026"], date(2026, 2, 20))
    del values["DO"]
    with pytest.raises(ValueError, match="no DO sheet"):
        read_do_sheet(values)


def _quote_book() -> Workbook:
    wb = Workbook()
    ws = wb.active
    ws.title = "DATA ENTRI"
    ws["D3"] = "Q-965129/GNS/III/2026"
    ws["D4"] = "Jakarta, 30 March 2026"
    for col, label in zip(
        "ABCDFG", ["No.", "Qty", "Unit", "Request", "Offer", "JUAL"], strict=True
    ):
        ws[f"{col}11"] = label
    ws.append([])
    ws["A14"], ws["B14"], ws["C14"] = "1", 1, "Pcs"
    ws["F14"], ws["G14"], ws["H14"] = "Dial Bore Gauge Mitutoyo", 5000000, 5000000
    ws["B16"], ws["C16"] = 1, "Pcs"
    ws["F16"], ws["G16"], ws["H16"] = "Dial Bore Gauge No Brand", "1400000", 1400000
    ws["B17"], ws["C17"], ws["E17"] = 2, "Pack", 612345
    ws["F17"], ws["G17"], ws["H17"] = "No Offer", 0, 0
    ws["B18"], ws["F18"], ws["G18"], ws["H18"] = 2, "Two pack", 1000, 2000
    ws["G22"], ws["H22"] = "TOTAL", 6402000
    return wb


def test_read_quote_rows_and_find_price() -> None:
    quote = read_quote(_quote_book())
    assert quote.printed_number == "Q-965129/GNS/III/2026"
    assert quote.printed_date == date(2026, 3, 30)
    assert [r.row for r in quote.rows] == [14, 16, 17, 18]
    assert [r.price for r in quote.rows] == [
        Decimal("5000000"),
        Decimal("1400000"),
        Decimal("0"),
        Decimal("1000"),
    ]
    assert quote.rows[1].qty == Decimal("1")
    assert quote.rows[1].text == "Dial Bore Gauge No Brand"
    assert [r.row for r in quote.rows_priced(Decimal("1400000"))] == [16]
    assert quote.rows_priced(Decimal("6402000")) == []
    # Amounts and IMPA codes are not prices
    assert quote.rows_priced(Decimal("2000")) == []
    assert quote.rows_priced(Decimal("612345")) == []


def test_read_quote_needs_a_date() -> None:
    wb = _quote_book()
    wb["DATA ENTRI"]["D4"] = "Jakarta,"
    with pytest.raises(ValueError, match="no quotation date"):
        read_quote(wb)
