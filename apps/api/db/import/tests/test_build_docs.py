"""Unit tests for build_docs decisions checked against the files."""

import pytest

from build_docs import base_number, check_relation


def test_base_number_ignores_offer_suffix() -> None:
    assert base_number("Q-963010-O/GNS/I/2026") == "Q-963010/GNS/I/2026"
    assert base_number("Q-963010/GNS/I/2026") == "Q-963010/GNS/I/2026"
    assert base_number(None) is None


@pytest.mark.parametrize(
    ("relation", "main", "other", "same", "ok"),
    [
        ("copy", "Q-1/GNS/I/2026", "Q-1/GNS/I/2026", True, True),
        ("copy", "Q-1/GNS/I/2026", "Q-1/GNS/I/2026", False, False),
        ("earlier_version", "Q-1-O/GNS/I/2026", "Q-1/GNS/I/2026", False, True),
        ("earlier_version", "Q-1/GNS/I/2026", "Q-1/GNS/I/2026", True, False),
        ("earlier_version", "Q-1/GNS/I/2026", "Q-2/GNS/I/2026", False, False),
        ("different_number", "Q-1/GNS/I/2026", "Q-2/GNS/I/2026", False, True),
        ("different_number", "Q-1/GNS/I/2026", "Q-1-O/GNS/I/2026", False, False),
        ("sibling", "Q-1/GNS/I/2026", "Q-2/GNS/I/2026", False, False),
    ],
)
def test_check_relation(relation: str, main: str, other: str, same: bool, ok: bool) -> None:
    if ok:
        check_relation(relation, main, other, same)
    else:
        with pytest.raises(ValueError, match="relation"):
            check_relation(relation, main, other, same)
