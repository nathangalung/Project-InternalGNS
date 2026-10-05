"""Unit tests for file discovery and file-name parsing."""

from pathlib import Path

import pytest

from scan import discover, name_exclusion, parse_file_name


def test_discover_is_recursive_and_sorted(tmp_path: Path) -> None:
    (tmp_path / "Quotation 2024" / "NGK").mkdir(parents=True)
    (tmp_path / "Quotation 2024" / "Q-333 (O Ring) - NGK.xlsx").write_bytes(b"")
    (tmp_path / "Quotation 2024" / "NGK" / "Q-334 (O Ring) - NGK.xlsx").write_bytes(b"")
    (tmp_path / "Quotation 2024" / "Q-333.pdf").write_bytes(b"")
    found = discover(tmp_path)
    assert [p.relative_to(tmp_path).as_posix() for p in found] == [
        "Quotation 2024/NGK/Q-334 (O Ring) - NGK.xlsx",
        "Quotation 2024/Q-333 (O Ring) - NGK.xlsx",
    ]


@pytest.mark.parametrize(
    ("name", "reason"),
    [
        ("~$Q-951001 (Accu) - Karunia Aman Selalu.xlsx", "lock file"),
        ("Template Horizontal.xlsx", "template"),
        ("Template Vertical.xlsx", "template"),
        ("Q-951001 (Accu GS N200) - Karunia Aman Selalu.xlsx", None),
    ],
)
def test_name_exclusion(name: str, reason: str | None) -> None:
    assert name_exclusion(name) == reason


@pytest.mark.parametrize(
    ("name", "number", "suffix", "refs", "parts", "client", "markers"),
    [
        (
            "Q-963173-O (V-96-9401-003-D_04 -Tape Hatch Cover - Dewi Ambarwati) - Pelita Global Logistik.xlsx",
            "963173", "O", ["V-96-9401-003-D_04"], ["Tape Hatch Cover", "Dewi Ambarwati"],
            "Pelita Global Logistik", [],
        ),
        (
            "Q-509 (No. 99_DS-91_RatuDamai_V_24 ) - Isna Agung Pertama.xlsx",
            "509", None, ["99_DS-91_RatuDamai_V_24"], [], "Isna Agung Pertama", [],
        ),
        (
            "Q-959419 - (TCP 2509-90082 - FC DLS - Asam-asam) - Transcoal Pasific.xlsx",
            "959419", None, ["TCP 2509-90082"], ["FC DLS", "Asam-asam"], "Transcoal Pasific", [],
        ),
        (
            "Q-956190 (R7707-V-0039-REQ025 (1)  - Yuxin Satu) - IMC Shipping Management.xlsx",
            "956190", None, ["R7707-V-0039-REQ025"], ["Yuxin Satu"], "IMC Shipping Management",
            ["(1)"],
        ),
        (
            "Q-953174 rev (V-95-9401-139-E_05  - Dewi Ambarwati) - Pelita Global Logistik.xlsx",
            "953174", None, ["V-95-9401-139-E_05"], ["Dewi Ambarwati"], "Pelita Global Logistik",
            ["rev"],
        ),
        (
            "Q-952162 (Sensor - Dewi Ambarwati) - Pelita Global Logistik - revisi harga.xlsx",
            "952162", None, [], ["Sensor", "Dewi Ambarwati"], "Pelita Global Logistik",
            ["revisi harga"],
        ),
        ("Q-335-R (Seal) - pelita.xlsx", "335", "R", [], ["Seal"], "pelita", ["-R"]),
        ("Q-604 - Isna Agung Permata.xlsx", "604", None, [], [], "Isna Agung Permata", []),
        (
            "Q-964294 Selenoid Yuken LBS-50-2-A220-14  - MV Yuxin Satu - IMC Shipping Management.xlsx",
            "964294", None, [], ["Selenoid Yuken LBS-50-2-A220-14", "MV Yuxin Satu"],
            "IMC Shipping Management", [],
        ),
        (
            "Q-961119 (Port to port JKT-Kendari) - Sentra Makmur Lines (1).xlsx",
            "961119", None, [], ["Port to port JKT-Kendari"], "Sentra Makmur Lines", ["(1)"],
        ),
        (
            "Q-484 (Single Gas Detector).pdf.xlsx",
            "484", None, [], ["Single Gas Detector"], None, [".pdf.xlsx"],
        ),
        (
            "Q-956212 (7707_V-0048_REQ25 - Relay Push Botton) - IMC Ship Management(AutoRecovered).xlsx",
            "956212", None, ["7707_V-0048_REQ25"], ["Relay Push Botton"], "IMC Ship Management",
            ["AutoRecovered"],
        ),
        (
            "Q-956216-2 (R7707-V-0021-REQ025 - Yuxin Satu) - IMC Shipping Management (version 1).xlsb.xlsx",
            "956216", "2", ["R7707-V-0021-REQ025"], ["Yuxin Satu"], "IMC Shipping Management",
            ["version 1", "-2"],
        ),
        (
            "Q-962056 (V-96-9405-125-E_01 - GATE VALVE - Pelita Almeira Pertiwi) - Pelita Global Logistik - Revision.xlsx",
            "962056", None, ["V-96-9405-125-E_01"], ["GATE VALVE", "Pelita Almeira Pertiwi"],
            "Pelita Global Logistik", ["Revision"],
        ),
        (
            "Q-962056 (V-96-9405-125-E_01 - Revision - Pelita Almeira Pertiwi) - Pelita Global Logistik.xlsx",
            "962056", None, ["V-96-9405-125-E_01"], ["Pelita Almeira Pertiwi"],
            "Pelita Global Logistik", ["Revision"],
        ),
        (
            "Q-954409 (Rod Seal 10 16 6 3 - requote) - NGK.xlsx",
            "954409", None, [], ["Rod Seal 10 16 6 3"], "NGK", ["requote"],
        ),
        (
            "Q-567 (Wire Mooring Rope rev 901_D_07_2024 - MV Yuxin Satu) - IMC.xlsx",
            "567", None, ["901_D_07_2024"], ["Wire Mooring Rope rev", "MV Yuxin Satu"], "IMC", [],
        ),
        (
            "Q-954017 (Hallite 30 45 10 PU) - NGK.xlsx",
            "954017", None, [], ["Hallite 30 45 10 PU"], "NGK", [],
        ),
        (
            "Q-954413 (Oil Seal KOYO MHSA 28-42-8, Hallite DHS UHS) - PT Niterra Mobility Indonesia.xlsx",
            "954413", None, [], ["Oil Seal KOYO MHSA 28-42-8, Hallite DHS UHS"],
            "PT Niterra Mobility Indonesia", [],
        ),
        (
            "Q-565 (Deck Crane 903_E_07_2024 - MV Yuxin Satu) - IMC.xlsx",
            "565", None, ["903_E_07_2024"], ["Deck Crane", "MV Yuxin Satu"], "IMC", [],
        ),
        (
            "Q-968087-O (PR25-9602-0017-Vanbelt dll) - MBSS- Aman Maritim Nusantara.xlsx",
            "968087", "O", ["PR25-9602-0017-Vanbelt"], ["dll"], "MBSS", [],
        ),
        (
            "Q-9610225-O (Takel 5 Ton etc) - PT Ocean Maritim.xlsx",
            "9610225", "O", [], ["Takel 5 Ton etc"], "PT Ocean Maritim", [],
        ),
    ],
)  # fmt: skip
def test_parse_file_name(
    name: str,
    number: str,
    suffix: str | None,
    refs: list[str],
    parts: list[str],
    client: str | None,
    markers: list[str],
) -> None:
    fn = parse_file_name(name)
    assert (fn.number, fn.suffix) == (number, suffix)
    assert fn.refs == refs
    assert fn.parts == parts
    assert fn.client_hint == client
    assert fn.markers == markers


def test_parse_file_name_keeps_trailing_notes() -> None:
    fn = parse_file_name(
        "Q-956154 (MPC-300 PCB Module A) - PT Pelita Global Logistik - Pak Fakka.xlsx"
    )
    assert fn.client_hint == "PT Pelita Global Logistik"
    assert fn.notes == ["Pak Fakka"]
    assert fn.markers == []


def test_parse_file_name_without_number() -> None:
    fn = parse_file_name("Lumoso.xlsx")
    assert fn.number is None
    assert fn.parts == []
