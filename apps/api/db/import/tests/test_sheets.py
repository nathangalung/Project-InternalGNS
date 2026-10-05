"""Unit tests for DATA ENTRI and PRINT sheet reading."""

from __future__ import annotations

from helpers import grid
from sheets import map_columns, read_header, read_lines, read_print

HEADER_2024 = {
    "A2": "Customer :", "D2": "PT ISNA AGUNG PERMATA",
    "A3": "No :", "D3": "Q-509/GNS/VII/2024",
    "A4": "Tgl :", "D4": "Jakarta, 26 Juli 2024",
    "A5": "Attn :", "D5": "Bapak Contoh",
    "A6": "Email :", "D6": "pembelian@contoh.invalid",
    "E6": "stale@other.com",
    "A7": "Telp :",
    "A8": "Deliv. Time :", "D8": "5 working days after PO Doc received",
    "A9": "Halaman :", "D9": "1 OF 5",
}  # fmt: skip

V1 = {
    "A11": "No.", "B11": "Qty", "C11": "Unit", "D11": "Request", "E11": "IMPA",
    "F11": "Offer", "G11": "JUAL", "I11": "MODAL", "K11": "% profit", "L11": "Laba",
    "M11": "Nama Asli barang", "N11": "Vendor", "O11": "Telp",
}  # fmt: skip


def test_read_header_uses_column_d_by_label() -> None:
    h = read_header(grid(HEADER_2024))
    assert h.customer == "PT ISNA AGUNG PERMATA"
    assert h.number == "Q-509/GNS/VII/2024"
    assert h.date_raw == "Jakarta, 26 Juli 2024"
    assert h.contact == "Bapak Contoh"
    assert h.email == "pembelian@contoh.invalid"
    assert h.phone is None
    assert h.delivery_time == "5 working days after PO Doc received"


def test_read_header_extra_delivery_place_row() -> None:
    h = read_header(
        grid(
            {
                "A2": "Customer", "D2": "PT. IMC Ship Management",
                "A3": "No", "D3": "Q-964172/GNS/IV/2026",
                "A4": "Date", "D4": "Jakarta, 30 April 2026",
                "A5": "Attn", "D5": "Bp. Satu Dua Tiga",
                "A6": "Email", "D6": "satu@contoh.invalid",
                "A7": "Contact No.", "D7": "0812 1111 2222",
                "A8": "Deliv. Time", "D8": "3 working days",
                "A9": "Delivery Place", "D9": "Franco Jakarta",
                "A10": "Page", "D10": "1 OF 1",
            }
        )
    )  # fmt: skip
    assert h.phone == "0812 1111 2222"
    assert h.delivery_place == "Franco Jakarta"


def test_map_columns_v1_request_offer_impa() -> None:
    c = map_columns(grid({**HEADER_2024, **V1}))
    assert c is not None
    assert c.header_row == 10
    assert (c.no, c.qty, c.unit, c.request, c.impa, c.offer) == (0, 1, 2, 3, 4, 5)
    assert (c.sell, c.sell_amount, c.cost, c.cost_amount) == (6, 7, 8, 9)
    assert (c.nama_asli, c.vendor, c.channel) == (12, 13, 14)


def test_map_columns_v4_rp_prefix_and_subheaders() -> None:
    c = map_columns(
        grid(
            {
                "A11": "No.", "B11": "Qty", "C11": "Unit", "D11": "D E S C R I P T I O N",
                "G11": "JUAL", "L11": "BELI", "P11": "% profit", "Q11": "Laba",
                "R11": "Nama Asli barang", "S11": "Vendor", "T11": "Telp",
                "G12": "Harga Jual", "I12": "Amount", "L12": "Harga Beli", "N12": "Amount",
            }
        )
    )  # fmt: skip
    assert c is not None
    assert c.request == 3 and c.offer is None
    assert (c.sell, c.sell_amount, c.cost, c.cost_amount) == (6, 8, 11, 13)
    assert (c.nama_asli, c.vendor, c.channel) == (17, 18, 19)


def test_map_columns_penjualan_and_offer_description_in_d() -> None:
    v7 = map_columns(
        grid(
            {
                "A11": "No.", "B11": "Qty", "C11": "Unit", "D11": "D E S C R I P T I O N",
                "E11": "Penjualan", "G11": "Modal", "I11": "% profit",
                "E12": "unit price", "F12": "amount", "G12": "unit price", "H12": "amount",
            }
        )
    )  # fmt: skip
    assert v7 is not None
    assert (v7.sell, v7.sell_amount, v7.cost, v7.cost_amount) == (4, 5, 6, 7)
    v8 = map_columns(
        grid(
            {
                "A11": "No.", "B11": "Qty", "C11": "Unit",
                "D11": "O F F E R  D E S C R I P T I O N", "G11": "Harga Jual", "I11": "Modal",
            }
        )
    )  # fmt: skip
    assert v8 is not None
    assert v8.request is None and v8.offer == 3


def test_map_columns_v14_request_and_offer_descriptions() -> None:
    c = map_columns(
        grid(
            {
                "A11": "No.", "B11": "Qty", "C11": "Unit",
                "D11": "R E Q U E S T   D E S C R I P T I O N", "E11": "IMPA ",
                "F11": "O F F E R   D E S C R I P T I O N", "G11": "Harga Jual", "I11": "Modal",
            }
        )
    )  # fmt: skip
    assert c is not None
    assert (c.request, c.impa, c.offer) == (3, 4, 5)


def test_map_columns_without_section_labels_uses_subheaders() -> None:
    c = map_columns(
        grid(
            {
                "A11": "No.", "B11": "Qty", "C11": "Unit", "D11": "D E S C R I P T I O N",
                "K11": "% profit", "M11": "Nama Asli barang",
                "G12": "Unit Price", "H12": "Amount ", "I12": "Unit Price", "J12": "Amount ",
            }
        )
    )  # fmt: skip
    assert c is not None
    assert (c.sell, c.sell_amount, c.cost, c.cost_amount) == (6, 7, 8, 9)


def test_map_columns_two_sell_sections_picks_the_priced_one() -> None:
    c = map_columns(
        grid(
            {
                "A11": "No.", "B11": "Qty", "C11": "Unit", "D11": "D E S C R I P T I O N",
                "E11": "Harga Jual", "G11": "Harga Jual", "I11": "Modal",
                "A15": 1, "B15": 8, "D15": "Rinso", "E15": 0, "F15": 0,
                "G15": 610000, "H15": 4880000, "I15": 410000,
            }
        )
    )  # fmt: skip
    assert c is not None
    assert (c.sell, c.sell_amount) == (6, 7)
    assert "duplicate_sell_column" in c.flags


def test_map_columns_header_in_row_12() -> None:
    c = map_columns(grid({**{k.replace("11", "12"): v for k, v in V1.items()}}))
    assert c is not None
    assert c.header_row == 11


def test_map_columns_missing_header() -> None:
    assert map_columns(grid({"A2": "Customer"})) is None


def _lines(cells: dict[str, object]) -> tuple[list, list]:
    g = grid({**HEADER_2024, **V1, **cells})
    c = map_columns(g)
    assert c is not None
    return read_lines(g, c)


def test_read_lines_basic_fields() -> None:
    lines, skipped = _lines(
        {
            "A14": 1, "B14": 4, "C14": "PCS", "D14": "ELECTRIC BLOWERS", "E14": 591506,
            "F14": "IMPA 591418 fan", "G14": 4800000, "H14": 19200000, "I14": 3200000,
            "J14": 12800000, "M14": "Blower asli", "N14": "Toko A", "O14": "Toped",
        }
    )  # fmt: skip
    assert skipped == []
    (ln,) = lines
    assert (ln.row, ln.no, ln.qty, ln.unit) == (14, "1", 4.0, "PCS")
    assert (ln.request, ln.impa, ln.offer) == ("ELECTRIC BLOWERS", 591506, "IMPA 591418 fan")
    assert (ln.sell, ln.sell_amount, ln.cost, ln.cost_amount) == (
        4800000.0,
        19200000.0,
        3200000.0,
        12800000.0,
    )
    assert (ln.nama_asli, ln.vendor, ln.channel) == ("Blower asli", "Toko A", "Toped")


def test_read_lines_rp_prefix_values() -> None:
    g = grid(
        {
            "A11": "No.", "B11": "Qty", "C11": "Unit", "D11": "D E S C R I P T I O N",
            "G11": "JUAL", "L11": "BELI", "P11": "% profit",
            "G12": "Harga Jual", "I12": "Amount", "L12": "Harga Beli", "N12": "Amount",
            "A15": 1, "B15": 1, "C15": "Pc", "D15": "Computer", "G15": "Rp.", "H15": 8000000,
            "I15": "Rp.", "J15": 8000000, "L15": "Rp.", "M15": 5100000, "N15": "Rp.",
            "O15": 5100000,
        }
    )  # fmt: skip
    c = map_columns(g)
    assert c is not None
    (ln,), _ = read_lines(g, c)
    assert (ln.sell, ln.sell_amount, ln.cost, ln.cost_amount) == (
        8000000.0,
        8000000.0,
        5100000.0,
        5100000.0,
    )


def test_read_lines_continuation_label_and_total_rows() -> None:
    lines, skipped = _lines(
        {
            "A14": 1, "B14": 1, "C14": "Pc", "D14": "Computer", "G14": 100,
            "D15": "Original licensed Windows 11",
            "A16": "Customer :", "D16": "PT ISNA AGUNG PERMATA",
            "A17": "No.", "B17": "Qty",
            "A18": 2, "B18": 3, "C18": "Pcs", "D18": "Total Length: 100 m cable", "G18": 50,
            "A19": "#NAME?", "B19": 2, "C19": "Set", "D19": "Kit sub-line", "G19": 20,
            "B20": 5, "C20": "Pcs", "D20": "Unnumbered priced line", "G20": 10,
            "G21": "TOTAL", "H21": 450,
            "A23": 3, "B23": 1, "D23": "Scratch row after the total", "G23": 99,
        }
    )  # fmt: skip
    assert [ln.request for ln in lines] == [
        "Computer\nOriginal licensed Windows 11",
        "Total Length: 100 m cable",
        "Kit sub-line",
        "Unnumbered priced line",
    ]
    assert [ln.no for ln in lines] == ["1", "2", "#NAME?", None]
    assert [(s.row, s.reason) for s in skipped] == [(23, "after total")]


def test_read_lines_price_only_note_row_joins_the_line_above() -> None:
    lines, _ = _lines(
        {
            "A15": 1, "B15": 5, "C15": "Pcs", "D15": "Seal SB 73*95*14", "G15": 480000,
            "H15": 2400000,
            "D16": "minimal order 10pcs", "G16": 350000, "I16": 150000,
        }
    )  # fmt: skip
    assert [ln.request for ln in lines] == ["Seal SB 73*95*14\nminimal order 10pcs"]


def test_read_lines_page_totals_of_a_multi_page_table() -> None:
    lines, skipped = _lines(
        {
            "A14": 1, "B14": 1, "D14": "Computer", "G14": 8000000, "H14": 8000000,
            "H20": "TOTAL", "J20": 8000000,
            "A24": "Customer :", "D24": "PT. IMC Ship Management",
            "A33": "No.", "B33": "Qty",
            "A37": 1, "B37": 1, "D37": "Monitor", "G37": 1720000, "H37": 1720000,
            "H45": "TOTAL", "J45": 1720000,
            "A47": 9, "B47": 1, "D47": "Scratch after the last total", "G47": 5,
        }
    )  # fmt: skip
    assert [ln.request for ln in lines] == ["Computer", "Monitor"]
    assert [(s.row, s.reason) for s in skipped] == [(47, "after total")]


def test_read_lines_cost_breakdown_and_trade_in_rows() -> None:
    lines, _ = _lines(
        {
            "A14": 1, "B14": 1, "D14": "Personal computer", "G14": 15600000, "H14": 15600000,
            "D15": "RAM 16GB DDR5", "I15": 4470000,
            "F16": "Trade-in old compressor", "H16": -23250000,
        }
    )  # fmt: skip
    assert [(ln.request, ln.offer, ln.sell_amount) for ln in lines] == [
        ("Personal computer\nRAM 16GB DDR5", None, 15600000.0),
        (None, "Trade-in old compressor", -23250000.0),
    ]


def test_read_lines_reports_rows_without_description() -> None:
    lines, skipped = _lines({"A14": 1, "B14": 2, "C14": "Pcs", "G14": 500, "M14": "Asli"})
    assert lines == []
    assert [(s.row, s.reason) for s in skipped] == [(14, "no description")]


def test_read_lines_ignores_template_residue() -> None:
    lines, skipped = _lines({"G14": "Rp.", "H14": 0, "J14": 0, "K14": "#DIV/0!"})
    assert lines == [] and skipped == []


PRINT_2025 = {
    "A7": "To", "C7": "PT. KARUNIA AMAN SELALU", "F7": "No.", "G7": "Q-951001/GNS/I/2025",
    "A8": "Attn", "C8": "Bapak Contoh", "F8": "Your Ref no.", "G8": "by WA",
    "A9": "Email ", "C9": 0, "F9": "Date", "G9": "Jakarta, 07 January 2025",
    "A10": "Telp.", "F10": "Page", "G10": "1 OF 1",
    "A13": "No.", "B13": "Qty", "C13": "Unit", "D13": "D E S C R I P T I O N",
    "F13": "Unit Price", "G13": "Amount",
    "D15": "SHIP: MV YUXIN SATU",
    "A17": 1, "B17": 2, "C17": "pcs", "D17": "ACCU GS N200", "F17": 4700000, "G17": 9400000,
    "A18": 2, "B18": 8, "C18": "Pcs", "D18": "Clemp", "F18": 61500, "G18": 492000,
    "F40": "Total", "G40": 9892000,
    "F41": "Diskon", "G41": 0,
    "F42": "Sub Total", "G42": 9892000,
    "F43": "DPP Nilai Lain", "G43": 9067666.666666666,
    "F44": "PPN 12%", "G44": 1088120.0,
    "F45": "Grand Total", "G45": 10980120,
    "A47": "DELIVERY TIME", "E47": "2 working days after PO received",
    "A48": "PLACE OF DELIVERY", "E48": "PT. KARUNIA AMAN SELALU",
    "A49": "PAYMENT", "E49": "30 Days",
    "A50": "VALIDITY", "E50": "3 days",
}  # fmt: skip


def test_read_print_meta_footer_and_vessel_line() -> None:
    p = read_print(grid(PRINT_2025))
    assert p.to == "PT. KARUNIA AMAN SELALU"
    assert p.number == "Q-951001/GNS/I/2025"
    assert p.your_ref == "by WA"
    assert p.date_raw == "Jakarta, 07 January 2025"
    assert p.email is None
    assert p.phone is None
    assert p.page == "1 OF 1"
    assert p.pre_rows == ["SHIP: MV YUXIN SATU"]
    assert (p.delivery_time, p.delivery_place, p.payment, p.validity) == (
        "2 working days after PO received",
        "PT. KARUNIA AMAN SELALU",
        "30 Days",
        "3 days",
    )


def test_read_print_totals_2025_order() -> None:
    t = read_print(grid(PRINT_2025)).totals
    assert t is not None
    assert (t.gross, t.discount, t.net, t.dpp, t.ppn, t.grand) == (
        9892000,
        0,
        9892000,
        9067666.666666666,
        1088120.0,
        10980120,
    )
    assert (t.discount_label, t.ppn_rate) == ("Diskon", 12.0)


def test_read_print_totals_2024_order_with_colons() -> None:
    p = read_print(
        grid(
            {
                "A7": "To.", "C7": ":", "D7": "PT. NITERRA", "H7": "No.", "J7": ":",
                "K7": "Q-333/GNS/V/2024",
                "A8": "Attn", "C8": ":", "D8": "Bapak Wawan", "H8": "Your Ref no.", "J8": ":",
                "A13": "No.", "B13": "Qty", "D13": "Unit", "E13": "D E S C R I P T I O N",
                "H13": "Unit Price", "K13": "Amount",
                "A17": 1, "B17": 30, "D17": "Pcs", "E17": "Oring", "H17": "Rp.", "I17": 5000,
                "K17": "Rp.", "L17": 150000,
                "I31": "Sub Total :", "K31": "Rp.", "L31": 150000,
                "I32": "Disk 5%", "K32": "Rp.", "L32": -7500,
                "I33": "PPN 11%", "K33": "Rp.", "L33": 15675,
                "I34": "TOTAL", "K34": "Rp.", "L34": 158175,
                "A37": "DELIVERY TIME", "F37": ":", "G37": "Ready stock",
                "A39": "PAYMENT", "F39": ":", "G39": "30 Days",
            }
        )
    )  # fmt: skip
    assert p.to == "PT. NITERRA"
    assert p.your_ref is None
    assert (p.delivery_time, p.payment) == ("Ready stock", "30 Days")
    t = p.totals
    assert t is not None
    assert (t.gross, t.discount, t.discount_pct_label, t.ppn, t.ppn_rate, t.grand) == (
        150000,
        7500,
        5.0,
        15675,
        11.0,
        158175,
    )
    assert t.net is None and t.dpp is None


def test_read_print_totals_skip_page_subtotals() -> None:
    p = read_print(
        grid(
            {
                "A12": "No.", "B12": "Qty", "C12": "Unit", "D12": "REQUEST",
                "H12": "Unit Price", "I12": "Amount",
                "A14": 1, "B14": 1, "D14": "Thing", "H14": 10, "I14": 10,
                "H28": "Sub Total (1):", "I28": 10,
                "A43": 2, "B43": 1, "D43": "Other", "H43": 20, "I43": 20,
                "H60": "Sub Total (2) ", "I60": 20,
                "H62": "Total", "I62": 30,
                "H63": "Disk 5%", "I63": -1.5,
                "H64": "PPn 11%", "I64": 3.135,
                "H65": "Grand Total", "I65": 31.635,
            }
        )
    )  # fmt: skip
    t = p.totals
    assert t is not None
    assert (t.gross, t.discount, t.ppn, t.grand) == (30, 1.5, 3.135, 31.635)


def test_read_print_inline_labels_of_a_pdf_export() -> None:
    p = read_print(
        grid(
            {
                "A5": "To                        : PT. IMC Ship Management\n"
                "Attn                    :  Bp. Satu Dua Tiga",
                "H5": "No.                              :                Q-956216/GNS/VII/2025",
                "H6": "Your Ref No.             :                     7707-V-0021-REQ025",
                "H7": "Date                           :                       Jakarta, 15 July 2025",
                "A9": "No.", "B9": "Qty", "C9": "Unit", "D9": "REQUEST", "F9": "IMPA",
                "G9": "O F F E R   D E S C R I P T I O N", "H9": "Unit Price",
                "A10": 4, "B10": 20, "C10": "PCS", "D10": "MV YUXIN SATU\n\nHAMMER CHIPPING",
                "F10": 615757, "G10": "Hammer Chipping 500gr", "H10": 85000, "I10": 1700000,
                "H29": " Total ", "I29": 1700000,
                "H34": " Grand Total ", "I34": 1700000,
                "A35": "\nDELIVERY PLACE                       :  PT. IMC Ship Management\n"
                "PAYMENT                                  :  30 days",
            }
        )
    )  # fmt: skip
    assert p.to == "PT. IMC Ship Management"
    assert p.attn == "Bp. Satu Dua Tiga"
    assert p.number == "Q-956216/GNS/VII/2025"
    assert p.your_ref == "7707-V-0021-REQ025"
    assert p.date_raw == "Jakarta, 15 July 2025"
    assert (p.delivery_place, p.payment) == ("PT. IMC Ship Management", "30 days")
    assert p.columns is not None
    (ln,) = p.lines
    assert (ln.no, ln.qty, ln.impa, ln.offer, ln.sell, ln.sell_amount) == (
        "4",
        20.0,
        615757,
        "Hammer Chipping 500gr",
        85000.0,
        1700000.0,
    )
    assert ln.request == "MV YUXIN SATU\n\nHAMMER CHIPPING"


def test_read_totals_blank_gap_and_delivery_charge() -> None:
    p = read_print(
        grid(
            {
                "A12": "No.", "B12": "Qty", "C12": "Unit", "D12": "REQUEST",
                "H12": "Unit Price", "I12": "Amount",
                "A16": 2, "B16": 80, "D16": "Nut", "H16": 75000, "I16": 6000000,
                "H27": "Total", "I27": 6000000,
                "H28": "Disk 5%", "I28": -300000,
                "H29": "PPn 11%", "I29": 627000,
                "F30": "Delivery  to MV on achorage", "I30": 1000000,
                "H32": "Grand Total", "I32": 7327000,
            }
        )
    )  # fmt: skip
    t = p.totals
    assert t is not None
    assert (t.gross, t.discount, t.ppn, t.grand) == (6000000, 300000, 627000, 7327000)
    assert t.extras == [("Delivery to MV on achorage", 1000000.0, False)]
    assert len(p.lines) == 1


def test_read_totals_stacked_in_single_cells() -> None:
    t = read_print(
        grid(
            {
                "A9": "No.", "B9": "Qty", "D9": "REQUEST", "I9": "Unit Price", "J9": "Amount",
                "A10": 4, "B10": 20, "D10": "Hammer", "I10": 85000, "J10": 1700000,
                "I29": "Total\nDiskon 5%\nSub Total\nDPP Nilai Lain\nPPN 12%\nGrand Total",
                "J30": "Rp\nRp\nRp\nRp\nRp",
                "K30": "12.345.600\n617.280\n11.728.320\n10.750.960\n1.290.115",
                "J31": "Rp                       13.018.435",
            }
        )
    ).totals  # fmt: skip
    assert t is not None
    assert (t.gross, t.discount, t.net, t.ppn, t.grand) == (
        12345600,
        617280,
        11728320,
        1290115,
        13018435,
    )


def test_read_lines_skips_rp_dash_filler() -> None:
    lines, skipped = _lines({"G26": "Rp -", "H26": "Rp -"})
    assert lines == [] and skipped == []


def test_read_totals_without_ppn_row() -> None:
    t = read_print(
        grid(
            {
                "A13": "No.", "B13": "Qty", "E13": "D E S C R I P T I O N", "H13": "Unit Price",
                "K13": "Amount",
                "A17": 1, "B17": 2, "E17": "Floatless Level Switch", "H17": "Rp.", "I17": 2240000,
                "K17": "Rp.", "L17": 4480000,
                "I35": "Sub Total :", "K35": "Rp.", "L35": 4480000,
                "I36": "Disk ", "K36": "Rp.", "L36": 0,
                "I37": "TOTAL", "K37": "Rp.", "L37": 4480000,
            }
        )
    ).totals  # fmt: skip
    assert t is not None
    assert (t.gross, t.discount, t.net, t.ppn_label, t.grand) == (
        4480000,
        0,
        4480000,
        None,
        4480000,
    )


def test_read_totals_withheld_pph() -> None:
    t = read_print(
        grid(
            {
                "A12": "No.", "B12": "Qty", "D12": "D E S C R I P T I O N", "F12": "Unit Price",
                "G12": "Amount",
                "A16": 1, "B16": 1, "D16": "VDR APT", "F16": 25000000, "G16": 25000000,
                "F40": "Total", "G40": 25000000,
                "F41": "Diskon", "G41": 0,
                "F42": "DPP", "G42": 25000000,
                "F43": "PPH 2%", "G43": -500000,
                "F44": "Grand Total", "G44": 24500000,
            }
        )
    ).totals  # fmt: skip
    assert t is not None
    assert t.extras == [("PPH 2%", -500000.0, False)]
    assert (t.dpp, t.grand) == (25000000, 24500000)


def test_read_totals_unpriced_note_inside_block() -> None:
    t = read_print(
        grid(
            {
                "A13": "No.", "B13": "Qty", "D13": "REQUEST", "I13": "Unit Price", "K13": "Amount",
                "A16": 1, "B16": 4, "D16": "Karet", "I16": 86000, "K16": 344000,
                "I22": " Total ", "K22": 344000, "L22": "\xa0",
                "I23": " Diskon 5% ", "K23": -17200,
                "I24": " Sub Total ", "K24": 326800,
                "I25": " DPP Nilai Lain ", "K25": 299566.6666666667,
                "I26": " PPN 12% ", "K26": 35948.0,
                "H27": "Shipping to Weda", "K27": "\xa0",
                "I28": " Grand Total ", "K28": 335514.6666666667,
            }
        )
    ).totals  # fmt: skip
    assert t is not None
    assert (t.gross, t.discount, t.net, t.grand) == (344000, 17200, 326800, 335514.6666666667)
    assert t.extras == []
