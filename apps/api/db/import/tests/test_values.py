"""Unit tests for cell value helpers."""

from datetime import date, datetime

import pytest

from values import (
    canonical_client,
    clean_text,
    impa_codes_in_text,
    is_no_offer,
    parse_date,
    parse_impa,
    parse_number,
)


@pytest.mark.parametrize(
    ("raw", "want"),
    [
        (None, None),
        ("", None),
        ("  \xa0 ", None),
        (" Bapak Contoh\xa0", "Bapak Contoh"),
        ("line one  \nline two ", "line one\nline two"),
        (591506, "591506"),
        (12.0, "12"),
    ],
)
def test_clean_text(raw: object, want: str | None) -> None:
    assert clean_text(raw) == want


@pytest.mark.parametrize(
    ("raw", "want"),
    [
        (None, None),
        (True, None),
        (5, 5.0),
        (82987.5, 82987.5),
        ("1500000", 1500000.0),
        ("1.500.000", 1500000.0),
        ("Rp 1.500.000", 1500000.0),
        ("1,500,000", 1500000.0),
        ("2,5", 2.5),
        ("12.5", 12.5),
        ("#REF!", None),
        ("#NAME?", None),
        ("Rp.", None),
        ("-", None),
        ("abc", None),
    ],
)
def test_parse_number(raw: object, want: float | None) -> None:
    assert parse_number(raw) == want


@pytest.mark.parametrize(
    ("raw", "want"),
    [
        ("Jakarta, 26 Juli 2024", date(2024, 7, 26)),
        ("Jakarta, 07 January 2025", date(2025, 1, 7)),
        ("Jakarta, 9 August 2025", date(2025, 8, 9)),
        ("Jakarta, 14 Agustsus 2026", date(2026, 8, 14)),
        ("Jakarta, 02 September2025", date(2025, 9, 2)),
        ("Jakarta, 03 Sept 2024", date(2024, 9, 3)),
        ("Jakarta, 12 Okt 2025", date(2025, 10, 12)),
        ("Jakarta, 01 Desember 2025", date(2025, 12, 1)),
        ("Jakarta, 09/07/2024", date(2024, 7, 9)),
        (datetime(2025, 7, 16, 0, 0), date(2025, 7, 16)),
        (date(2025, 7, 16), date(2025, 7, 16)),
        ("Jakarta, 31 Februari 2025", None),
        ("", None),
        (None, None),
    ],
)
def test_parse_date(raw: object, want: date | None) -> None:
    assert parse_date(raw) == want


@pytest.mark.parametrize(
    ("raw", "code", "problem"),
    [
        (591506, "591506", None),
        ("591506", "591506", None),
        (591506.0, "591506", None),
        (" 232191 ", "232191", None),
        (None, None, None),
        ("", None, None),
        ("#REF!", None, "invalid"),
        (0, None, "invalid"),
        ("-", None, "invalid"),
        ("CXH6-10S", None, "invalid"),
        (50325, None, "invalid"),
        (621234, None, "unknown_section"),
    ],
)
def test_parse_impa(raw: object, code: str | None, problem: str | None) -> None:
    assert parse_impa(raw) == (code, problem)


def test_impa_codes_in_text() -> None:
    assert impa_codes_in_text("IMPA 591418 Explotion proof fan") == ["591418"]
    assert impa_codes_in_text("Navigation light. \nImpa 370422") == ["370422"]
    assert impa_codes_in_text("impa: 650878 and IMPA#651802") == ["650878", "651802"]
    assert impa_codes_in_text("591486 (12in, 10M)") == []
    assert impa_codes_in_text(None) == []


@pytest.mark.parametrize(
    ("raw", "want"),
    [
        ("No Offer", True),
        ("no offer", True),
        ("NO OFFER", True),
        ("No offer. Prescription required", True),
        ("No Offer\n\nPO 2-3 days", True),
        ("No stock", True),
        ("MCB C60N Schneider - Offer 63A", False),
        ("offer M10x90", False),
        (None, False),
    ],
)
def test_is_no_offer(raw: str | None, want: bool) -> None:
    assert is_no_offer(raw) is want


@pytest.mark.parametrize(
    ("raw", "name", "note", "individual"),
    [
        ("PT. PELITA GLOBAL LOGISTIK", "PT. Pelita Global Logistik", None, False),
        ("PT Pelita Global Logistik", "PT. Pelita Global Logistik", None, False),
        ("PT. IMC Shipping Management", "PT. IMC Ship Management", None, False),
        ("IMC Ship Management", "PT. IMC Ship Management", None, False),
        ("PT. Transcoal Pasific", "PT. Transcoal Pacific", None, False),
        ("PT ISNA AGUNG PERTAMA", "PT. Isna Agung Permata", None, False),
        ("PT. KARYA SAMUDERA INSSANI", "PT. Karya Samudera Insani", None, False),
        ("PT Galley Andhika Arnawama", "PT. Galley Andhika Arnawama", None, False),
        ("PT AMARIN SHIP MANAGEMENT", "PT. Amarin Ship Management", None, False),
        ("PT OCEAN MARITIM", "PT. Ocean Maritim", None, False),
        (
            "PT Mitrabahtera Segara Sejati Tbk/PT Aman Maritim Nusantara",
            "PT. Mitrabahtera Segara Sejati Tbk",
            "PT Aman Maritim Nusantara",
            False,
        ),
        (
            "PT Kemala Shipping/MBSS",
            "PT. Kemala Shipping",
            "MBSS",
            False,
        ),
        ("Bapak Patrick Manurung", "Patrick Manurung", None, True),
    ],
)
def test_canonical_client(raw: str, name: str, note: str | None, individual: bool) -> None:
    got = canonical_client(raw)
    assert got is not None
    assert (got.name, got.broker_note, got.individual) == (name, note, individual)


def test_canonical_client_unknown() -> None:
    assert canonical_client("PT. Unknown Company") is None
    assert canonical_client(None) is None
