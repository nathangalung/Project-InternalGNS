"""Unit tests for the raw unit mapping."""

import pytest

from unit_map import map_unit


@pytest.mark.parametrize(
    ("raw", "code", "mapped"),
    [
        ("Pcs", "PCS", True),
        ("pcs\xa0", "PCS", True),
        ("Pc ", "PCS", True),
        ("Buah", "PCS", True),
        ("STRIP", "OTH", True),
        ("Tab", "OTH", True),
        ("SPL", "SPL", True),
        ("Spool", "SPL", True),
        ("Botol", "BTL", True),
        ("Lusin", "DOZ", True),
        ("Dosen", "DOZ", True),
        ("Coils", "RLS", True),
        ("rol", "RLS", True),
        ("kaleng", "TIN", True),
        ("Pairs", "PRS", True),
        ("pr", "PRS", True),
        ("pasang", "PRS", True),
        ("lembar", "LBR", True),
        ("duz", "BOX", True),
        ("CTN", "BOX", True),
        ("Litre", "LTR", True),
        ("MTRS", "MTR", True),
        ("Meters", "MTR", True),
        ("hari", "DAY", True),
        ("LGH", "LGH", True),
        ("C/T", "BOX", True),
        ("C/L", "RLS", True),
        ("1 PCS", "PCS", True),
        ("2 Set", "SET", True),
        ("CYL", "OTH", True),
        ("Karung", "OTH", True),
        ("Widget", "OTH", False),
        (None, None, False),
        ("", None, False),
    ],
)
def test_map_unit(raw: str | None, code: str | None, mapped: bool) -> None:
    assert map_unit(raw) == (code, mapped)
