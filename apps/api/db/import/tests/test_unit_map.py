"""Unit tests for the raw unit mapping."""

import pytest

from unit_map import IMPORT_OVERRIDES, map_unit, seed_vocabulary


@pytest.mark.parametrize(
    ("raw", "code", "mapped"),
    [
        ("Pcs", "PCS", True),
        ("pcs\xa0", "PCS", True),
        ("Pc ", "PCS", True),
        ("pcs.", "PCS", True),
        ("Buah", "PCS", True),
        ("EA", "PCS", True),
        ("each", "PCS", True),
        ("Pieces", "PCS", True),
        ("STRIP", "OTH", True),
        ("Tab", "OTH", True),
        ("SPL", "SPL", True),
        ("Spool", "SPL", True),
        ("Botol", "BTL", True),
        ("Lusin", "DOZ", True),
        ("Dosen", "DOZ", True),
        ("dzn", "DOZ", True),
        ("Coil", "COIL", True),
        ("Coils", "COIL", True),
        ("C/L", "COIL", True),
        ("rol", "RLS", True),
        ("Roll", "RLS", True),
        ("kaleng", "TIN", True),
        ("Can", "TIN", True),
        ("Pairs", "PRS", True),
        ("pr", "PRS", True),
        ("pasang", "PRS", True),
        ("lembar", "LBR", True),
        ("Sheet", "LBR", True),
        ("duz", "BOX", True),
        ("CTN", "BOX", True),
        ("Carton", "BOX", True),
        ("case", "BOX", True),
        ("C/T", "BOX", True),
        ("Litre", "LTR", True),
        ("m", "MTR", True),
        ("MTRS", "MTR", True),
        ("Meters", "MTR", True),
        ("hari", "DAY", True),
        ("LGH", "LGH", True),
        ("Batang", "LGH", True),
        ("Pail", "PAIL", True),
        ("Drum", "DRUM", True),
        ("pack", "PKT", True),
        ("PAX", "PKT", True),
        ("1 PCS", "PCS", True),
        ("2 Set", "SET", True),
        ("CYL", "OTH", True),
        ("Karung", "OTH", True),
        # Ampoule in the old files, never the Ampere code.
        ("amp", "OTH", True),
        ("Widget", "OTH", False),
        (None, None, False),
        ("", None, False),
    ],
)
def test_map_unit(raw: str | None, code: str | None, mapped: bool) -> None:
    assert map_unit(raw) == (code, mapped)


def test_every_seed_code_and_alias_resolves_like_the_app() -> None:
    codes, aliases = seed_vocabulary()
    assert {"PCS", "PKT", "COIL", "PAIL", "DRUM"} <= codes
    assert aliases["EA"] == "PCS"
    for code in codes - set(IMPORT_OVERRIDES):
        assert map_unit(code) == (code, True), code
    for alias, code in aliases.items():
        assert map_unit(alias) == (code, True), alias


def test_overrides_never_shadow_an_alias() -> None:
    _, aliases = seed_vocabulary()
    assert not set(IMPORT_OVERRIDES) & set(aliases)
    assert set(IMPORT_OVERRIDES.values()) == {"OTH"}
