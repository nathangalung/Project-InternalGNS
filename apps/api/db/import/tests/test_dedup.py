"""Unit tests for copy, revision and shared-number resolution."""

from __future__ import annotations

from typing import Any

from dedup import resolve_duplicates, similarity

Record = dict[str, Any]


def _rec(
    path: str,
    *,
    number: str = "Q-952162/GNS/V/2025",
    file_number: str = "Q-952162",
    client: str = "PT. Pelita Global Logistik",
    when: str = "2025-05-20",
    ref: str | None = "V-95-9404-290-D/02",
    lines: list[tuple[str, float]] | None = None,
    markers: list[str] | None = None,
    kind: str = "data_entry",
    grand: float | None = None,
) -> Record:
    lines = lines if lines is not None else [("Bolt M10", 100.0), ("Nut M10", 50.0)]
    return {
        "id": f"{path}#DATA ENTRI",
        "source": {"files": [path], "kind": kind},
        "file_name": {"number": file_number, "markers": markers or []},
        "number": {"original": number, "print": number, "sheet": number, "file": file_number},
        "client": {"name": client},
        "date": when,
        "client_ref": ref,
        "client_ref_source": "print",
        "vessel": None,
        "vessel_source": None,
        "discount": {"kind": "none", "pct": None, "amount": 0.0},
        "lines": [
            {
                "qty": 1.0,
                "unit_raw": "Pcs",
                "request": r,
                "offer": None,
                "sell": s,
                "available": True,
            }
            for r, s in lines
        ],
        "print_totals": {"grand": grand},
        "computed_totals": {"grand": sum(s for _, s in lines)},
        "flags": [],
        "duplicates": [],
        "revision": None,
    }


def test_similarity() -> None:
    a = _rec("a.xlsx")
    b = _rec("b.xlsx", lines=[("Bolt M10", 90.0), ("Washer", 5.0)])
    assert similarity(a, a) == 1.0
    assert similarity(a, b) == 1 / 3


def test_identical_copies_are_dropped_keeping_the_clean_name() -> None:
    a = _rec("Q-961119 (Port) - Sentra (1).xlsx", markers=["(1)"])
    b = _rec("Q-961119 (Port) - Sentra.xlsx")
    kept, dropped = resolve_duplicates([a, b])
    assert [r["id"] for r in kept] == [b["id"]]
    assert kept[0]["source"]["files"] == [
        "Q-961119 (Port) - Sentra.xlsx",
        "Q-961119 (Port) - Sentra (1).xlsx",
    ]
    assert kept[0]["duplicates"] == [
        {"path": "Q-961119 (Port) - Sentra (1).xlsx", "reason": "identical copy"}
    ]
    assert dropped == [{"id": a["id"], "kept": b["id"], "reason": "identical copy", "differs": []}]
    assert kept[0]["aliases"][0]["path"] == "Q-961119 (Port) - Sentra (1).xlsx"


def test_identical_content_under_two_numbers_is_one_quotation() -> None:
    a = _rec("Q-952119 (Trafo).xlsx", file_number="Q-952119")
    b = _rec("Q-952120 (Trafo).xlsx", file_number="Q-952120")
    kept, dropped = resolve_duplicates([a, b])
    assert len(kept) == 1 and len(dropped) == 1


def test_a_copy_printing_another_number_stays_as_an_alias() -> None:
    a = _rec("Q-956366 (Pump).xlsx", file_number="Q-956366", number="Q-956366/GNS/IX/2025")
    b = _rec("Q-956369 (Pump).xlsx", file_number="Q-956369", number="Q-956369/GNS/IX/2025")
    (kept,), (dropped,) = resolve_duplicates([a, b])
    assert dropped["differs"] == ["number"]
    assert [x["number"] for x in kept["aliases"]] == ["Q-956369/GNS/IX/2025"]
    assert "copy_number_differs" in kept["flags"]


def test_the_copy_with_more_evidence_survives_and_lends_its_vessel() -> None:
    # Q-962027: the copy printing the request reference outranks "By WA".
    by_wa = _rec("Q-962027 (Pump).xlsx", ref="By WA")
    with_ref = _rec("Q-962027 (V-96-9405-062-E_01 - Pump) - Pelita.xlsx", ref="V-96-9405-062-E/01")
    by_wa["vessel"], by_wa["vessel_source"] = "MV PELITA ALMEIRA", "print"
    with_ref["lines"][0]["cost"] = 11500000.0
    (kept,), (dropped,) = resolve_duplicates([by_wa, with_ref])
    assert kept["id"] == with_ref["id"]
    assert (kept["vessel"], kept["client_ref"]) == ("MV PELITA ALMEIRA", "V-96-9405-062-E/01")
    assert {"copy_differs", "vessel_from_copy"} <= set(kept["flags"])
    assert dropped["differs"] == ["vessel", "cost"]


def test_two_exports_of_one_print_merge_and_the_workbook_leads_the_chain() -> None:
    wb = _rec("Q-956216 (R7707) - IMC.xlsx", grand=12885185.3, lines=[("Bolt", 100.0)])
    a = _rec("Q-956216 (R7707) - IMC - Pak Satu.xlsx", kind="print_only", grand=13018435.25)
    b = _rec("PDF/Q-956216 (R7707) - IMC.xlsx", kind="print_only", grand=13018435.0)
    for r in (a, b):
        r["lines"][0]["request"] = "BOLT"
    wb["lines"][0]["request"] = "BOLT"
    kept, dropped = resolve_duplicates([a, b, wb])
    assert len(dropped) == 1 and len(kept) == 2
    base = next(r for r in kept if r["revision"]["index"] == 0)
    assert base["id"] == wb["id"]


def test_print_export_matching_a_workbook_is_a_copy() -> None:
    wb = _rec("Q-956216 (R7707) - IMC.xlsx", grand=13018435.25)
    export = _rec(
        "Quotation 2025 - PDF/Q-956216 (R7707) - IMC.xlsx",
        kind="print_only",
        lines=[("BOLT M10 LONG TEXT", 100.0)],
        grand=13018435.0,
    )
    kept, dropped = resolve_duplicates([wb, export])
    assert [r["id"] for r in kept] == [wb["id"]]
    assert dropped[0]["reason"] == "print export of the same quotation"


def test_revision_chain_by_date() -> None:
    base = _rec("Q-952162 (V-25) - Pelita.xlsx", when="2025-05-20")
    rev = _rec(
        "Q-952162 (V-25) - Pelita - revisi harga.xlsx",
        when="2025-05-22",
        lines=[("Bolt M10", 90.0), ("Nut M10", 45.0)],
        markers=["revisi harga"],
    )
    kept, dropped = resolve_duplicates([rev, base])
    assert dropped == []
    by_id = {r["id"]: r for r in kept}
    assert by_id[base["id"]]["revision"] == {
        "group": "2025:952162:PT. Pelita Global Logistik:1",
        "index": 0,
        "count": 2,
        "base_id": base["id"],
    }
    assert by_id[rev["id"]]["revision"]["index"] == 1


def test_same_number_different_quotations_stay_separate() -> None:
    a = _rec("Q-963010 (Cordless Impact Wrench).xlsx", ref=None, lines=[("Impact wrench", 1.0)])
    b = _rec("Q-963010 (Lampu LED).xlsx", ref=None, lines=[("Lampu LED 12W", 2.0)])
    c = _rec(
        "Q-965187 (Vbelt) - Kasen.xlsx",
        client="PT. Kasen Maritim Logistik",
        lines=[("Bolt M10", 100.0), ("Nut M10", 50.0)],
    )
    c["number"]["original"] = "Q-952162/GNS/V/2025"
    kept, _ = resolve_duplicates([a, b, c])
    assert all(r["revision"] is None for r in kept)
    assert all("shared_number" in r["flags"] for r in kept)


def test_same_lines_for_two_vessels_are_two_quotations() -> None:
    a = _rec("Q-952119 (Trafo - Daidan Mustikawati).xlsx", ref=None)
    b = _rec("Q-952120 (Trafo - Daidan Pertiwi).xlsx", ref=None, file_number="Q-952120")
    a["vessel"], a["vessel_source"] = "MV DAIDAN MUSTIKAWATI", "print"
    b["vessel"], b["vessel_source"] = "MV DAIDAN PERTIWI", "print"
    kept, dropped = resolve_duplicates([a, b])
    assert dropped == [] and all(r["revision"] is None for r in kept)
    assert all("same_lines_as_other_request" in r["flags"] for r in kept)


def test_matching_printed_reference_outranks_a_stale_vessel_line() -> None:
    a = _rec("Q-952162 (V-95-9404-290-D_02) Bolt Nut.xlsx")
    b = _rec("Q-952159 (V-95-9404-290-D_02) Bolt Nut.xlsx", file_number="Q-952159")
    a["vessel"], a["vessel_source"] = "MV PELITA MUSTIKAWATI", "print"
    b["vessel"], b["vessel_source"] = "MV DEWI AMBARWATI", "print"
    kept, dropped = resolve_duplicates([a, b])
    assert len(kept) == 1 and dropped[0]["reason"] == "identical copy"


def test_placeholder_reference_does_not_link_quotations() -> None:
    a = _rec("Q-951228 (kunci shock).xlsx", ref="by WA", lines=[("Kunci shock 18mm", 1.0)])
    b = _rec("Q-951298 (IC Regulator).xlsx", ref="by WA", lines=[("IC Regulator 24V", 1.0)])
    b["number"]["original"] = a["number"]["original"]
    kept, _ = resolve_duplicates([a, b])
    assert all(r["revision"] is None for r in kept)


def test_numbered_suffix_revision_with_partly_changed_lines() -> None:
    base = _rec(
        "Q-956216 (R7707) - IMC.xlsx", lines=[("A", 1.0), ("B", 1.0), ("C", 1.0), ("D", 1.0)]
    )
    rev = _rec(
        "Q-956216-2 (R7707) - IMC.xlsx",
        when="2025-05-21",
        lines=[("A", 1.0), ("B", 1.0), ("E", 1.0)],
        markers=["-2"],
    )
    kept, _ = resolve_duplicates([base, rev])
    assert sorted(r["revision"]["index"] for r in kept) == [0, 1]


def test_revision_suffix_links_even_when_every_line_changed() -> None:
    base = _rec("Q-335 (Endcap) - Indoglas.xlsx", ref=None, lines=[("Endcap 80 10", 200.0)])
    rev = _rec(
        "Q-335-R (Endcap) - Indoglas.xlsx",
        ref=None,
        when="2025-05-21",
        lines=[("Endcap 80 12", 230.0)],
        markers=["-R"],
    )
    kept, _ = resolve_duplicates([rev, base])
    assert [r["revision"]["index"] for r in kept] == [0, 1]


def test_reference_on_one_copy_and_vessel_on_the_other_is_still_a_copy() -> None:
    a = _rec("Q-965116 (DOL Starter - Marina 12).xlsx", ref=None)
    b = _rec("Q-965116 (DOL Starter).xlsx", ref="V-96-9405-005-E/02")
    a["vessel"], a["vessel_source"] = "TB MARINA 12", "print"
    kept, dropped = resolve_duplicates([a, b])
    assert len(kept) == 1 and len(dropped) == 1


def test_split_offer_of_one_request_is_not_a_revision() -> None:
    a = _rec("Q-963145-O (Kain Majun).xlsx", lines=[("Kain majun", 10.0), ("Helmet", 0.0)])
    b = _rec("Q-963145-O (Welding Helmet).xlsx", lines=[("Kain majun", 0.0), ("Helmet", 90.0)])
    a["lines"][1]["available"] = False
    b["lines"][0]["available"] = False
    kept, _ = resolve_duplicates([a, b])
    assert all(r["revision"] is None for r in kept)


def test_old_request_text_with_another_offer_is_not_a_revision() -> None:
    # Q-963145-O: the Kain Majun workbook kept the welding helmet request text.
    majun = _rec("Q-963145-O (Kain Majun).xlsx", lines=[("Welding Helmets", 37500.0)])
    helmet = _rec("Q-963145-O (Welding Helmet).xlsx", lines=[("Welding Helmets", 375000.0)])
    majun["lines"][0]["offer"] = "Kain Majun putih tanpa jahitan"
    helmet["lines"][0]["offer"] = "WELDING HELMET + GLASS AUTOMATIC"
    assert similarity(majun, helmet) == 0.0
    kept, _ = resolve_duplicates([majun, helmet])
    assert all(r["revision"] is None and "shared_number" in r["flags"] for r in kept)


def test_chains_merge_whatever_the_input_order() -> None:
    a = _rec("Q-1 a.xlsx", when="2025-05-01", lines=[("A", 1.0), ("B", 1.0), ("C", 1.0)])
    b = _rec("Q-1 b.xlsx", when="2025-05-03", lines=[("D", 1.0), ("E", 1.0), ("F", 1.0)])
    c = _rec(
        "Q-1 c.xlsx",
        when="2025-05-02",
        lines=[("A", 2.0), ("B", 2.0), ("C", 2.0), ("D", 2.0), ("E", 2.0), ("F", 2.0)],
    )
    kept, _ = resolve_duplicates([a, b, c])
    assert sorted((r["revision"]["index"], r["id"]) for r in kept) == [
        (0, a["id"]),
        (1, c["id"]),
        (2, b["id"]),
    ]


def test_revision_sheet_joins_its_own_workbook() -> None:
    # Q-502: the Q-499 workbook holds an earlier Q-502; Q-502's own
    # workbook has the full DATA and a "Print revisi" sheet.
    lines = [("Electrode RB26", 1.0), ("MCB C60N", 1.0), ("Plasma Cutting", 1.0), ("Headlamp", 1.0)]
    early = _rec(
        "Q-499 (Pipe Request) - IMC.xlsx",
        file_number="Q-499",
        number="Q-502/GNS/VII/2024",
        when="2024-07-18",
        client="PT. Isna Agung Permata",
        ref=None,
        lines=lines,
    )
    data = _rec(
        "Q-502 (Req 901 Engine) - Isna.xlsx",
        file_number="Q-502",
        number="Q-502/GNS/VII/2024",
        when="2024-07-20",
        client="PT. Isna Agung Permata",
        ref=None,
        lines=[*lines, ("Mica Sheet", 1.0)],
    )
    revised = _rec(
        "Q-502 (Req 901 Engine) - Isna.xlsx",
        file_number="Q-502",
        number="Q-502/GNS/VII/2024",
        when="2024-07-20",
        client="PT. Isna Agung Permata",
        ref=None,
        kind="print_only",
        markers=["sheet:Print revisi"],
        lines=[("Plasma Cutting", 0.9), ("Fluorescent lamps", 1.0)],
    )
    revised["id"] = revised["id"].replace("DATA ENTRI", "Print revisi")
    revised["revision_of"] = data["id"]
    kept, _ = resolve_duplicates([revised, early, data])
    chain = sorted(kept, key=lambda r: r["revision"]["index"])
    assert [r["id"] for r in chain] == [early["id"], data["id"], revised["id"]]
    assert all("revision_order_undetermined" not in r["flags"] for r in kept)


def test_stale_revision_sheet_of_another_client_is_dropped() -> None:
    q502 = _rec("Q-502 (Engine) - Isna.xlsx", client="PT. Isna Agung Permata")
    q655 = _rec("Q-655 (Filter) - KAS.xlsx", client="PT. Karunia Aman Selalu",
                lines=[("Filter SS202", 1.0)])  # fmt: skip
    stale = _rec("Q-655 (Filter) - KAS.xlsx", client="PT. Karunia Aman Selalu",
                 kind="print_only", markers=["sheet:Print revisi"])  # fmt: skip
    stale["id"] = stale["id"].replace("DATA ENTRI", "Print revisi")
    stale["source"]["sheet"] = "Print revisi"
    stale["revision_of"] = q655["id"]
    kept, dropped = resolve_duplicates([q502, q655, stale])
    assert {r["id"] for r in kept} == {q502["id"], q655["id"]}
    assert dropped[0]["reason"].startswith("stale revision sheet")
    assert q655["excluded_sheets"][0]["sheet"] == "Print revisi"


def test_same_date_without_a_marker_is_left_to_the_owner() -> None:
    a = _rec("Q-9610230-O (Kabel Ties) - Ocean.xlsx", lines=[("Kabel Ties", 85500.0)])
    b = _rec(
        "Q-9610230-O (Lampu FL) - Ocean.xlsx",
        lines=[("Lampu FL", 48000.0), ("Kabel Ties", 90000.0)],
    )
    kept, _ = resolve_duplicates([a, b])
    assert all("revision_order_undetermined" in r["flags"] for r in kept)


def test_reference_with_a_revision_prefix_is_the_same_request() -> None:
    a = _rec("Q-956216-2 (R7707) - Pak Satu.xlsx", ref="R7707/V/0021/Req025", kind="print_only")
    b = _rec("Q-956216-2 (R7707) - IMC.xlsx", ref="7707-V-0021-REQ025")
    for r in (a, b):
        r["file_name"]["refs"] = ["R7707-V-0021-REQ025"]
    b["lines"][0]["sell"] = 120.0
    kept, _ = resolve_duplicates([a, b])
    assert sorted(r["revision"]["index"] for r in kept) == [0, 1]


def test_printed_reference_the_file_name_contradicts_is_ignored() -> None:
    a = _rec("Q-956216-2 (R7707) - Pak Satu.xlsx", ref="R7707/V/0021/Req025")
    b = _rec("Q-956216-2 (R7707) - IMC.xlsx", ref="7707/V-0041/REQ25")
    for r in (a, b):
        r["file_name"]["refs"] = ["R7707-V-0021-REQ025"]
    b["lines"][0]["sell"] = 120.0
    kept, _ = resolve_duplicates([a, b])
    assert "client_ref_conflicts_file_name" in b["flags"]
    assert sorted(r["revision"]["index"] for r in kept) == [0, 1]


def test_another_clients_reference_format_is_flagged_and_ignored() -> None:
    pelita = [
        _rec(f"Q-25{i} - Pelita.xlsx", file_number=f"Q-25{i}", number=f"Q-25{i}/GNS/V/2025",
             ref=f"V-95-9404-{i:03d}-D/02", lines=[(f"Item {i}", 1.0)])
        for i in range(10)
    ]  # fmt: skip
    ocean = _rec("Q-9610230-O (Kabel Ties) - Ocean.xlsx", client="PT. Ocean Maritim",
                 ref="V-96-9405-002-E/02")  # fmt: skip
    resolve_duplicates([*pelita, ocean])
    assert "client_ref_foreign_format" in ocean["flags"]
    assert not any("client_ref_foreign_format" in r["flags"] for r in pelita)


def test_revision_without_a_common_line_is_related_not_chained() -> None:
    # Q-956216-2 quotes four other items of the same request.
    base = _rec("Q-956216 (R7707) - IMC.xlsx", ref="7707-V-0021-REQ025",
                lines=[("Hammer chipping", 1.0), ("Eyewear protective", 1.0)])  # fmt: skip
    other = _rec("Q-956216-2 (R7707) - IMC.xlsx", ref="R7707/V/0021/Req025", when="2025-07-16",
                 markers=["-2"], lines=[("Pilot ladder", 1.0), ("Chain drum", 1.0)])  # fmt: skip
    kept, _ = resolve_duplicates([base, other])
    assert all(r["revision"] is None for r in kept)
    assert base["related_to"] == [{"id": other["id"], "relation": "same_request_other_lines"}]


def test_revision_under_another_number_is_related_not_chained() -> None:
    # Q-962056 "Revision" re-quotes Q-962055's request four days later.
    q55 = _rec("Q-962055 (V-96-9405-125-E_01 - Gate Valve).xlsx", file_number="Q-962055",
               number="Q-962055/GNS/I/2026", when="2026-01-29", ref="V-96-9405-125-E/01",
               lines=[("Gate valve DN150", 1.0), ("Gate valve DN100", 1.0)])  # fmt: skip
    q56 = _rec("Q-962056 (V-96-9405-125-E_01 - Revision).xlsx", file_number="Q-962056",
               number="Q-962056/GNS/II/2026", when="2026-02-02", ref=None, markers=["Revision"],
               lines=[("Gate valve DN150", 0.9), ("Butterfly valve", 1.0)])  # fmt: skip
    q56["file_name"]["refs"] = ["V-96-9405-125-E_01"]
    kept, _ = resolve_duplicates([q55, q56])
    assert all(r["revision"] is None for r in kept)
    assert q56["related_to"] == [{"id": q55["id"], "relation": "revision_under_other_number"}]
    assert "revision_of_other_number" in q56["flags"]


def test_same_lines_for_another_client_are_kept_and_flagged() -> None:
    a = _rec("Q-965029 (Rudder) - Karunia Aman Selalu.xlsx", client="PT. Karunia Aman Selalu")
    b = _rec("Q-965029 (Rudder) - Karunia Aman Sentosa.xlsx", client="PT. Karunia Aman Sentosa")
    kept, dropped = resolve_duplicates([a, b])
    assert dropped == [] and len(kept) == 2
    assert all("same_lines_as_other_client" in r["flags"] for r in kept)
