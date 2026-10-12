"""The import's IMPA split matches the database's.

Both shared tables run here: fn_impa_split's cases from
db/migrations/testdata and the code format from the API's validate
package, so the seed holds names as every write stores them.
"""

import json
from pathlib import Path

import pytest

from values import impa_code, split_impa

_API = Path(__file__).resolve().parents[3]
_SPLIT = json.loads((_API / "db/migrations/testdata/impa_split.json").read_text())["cases"]
_RULES = json.loads((_API / "internal/shared/validate/testdata/impa_rules.json").read_text())[
    "cases"
]


@pytest.mark.parametrize("case", _SPLIT, ids=[c["note"] for c in _SPLIT])
def test_split_impa_matches_database(case: dict[str, object]) -> None:
    name, code = split_impa(case["name"], case["code"], bool(case["move"]))  # type: ignore[arg-type]
    assert (name, code) == (case["want_name"], case["want_code"])


@pytest.mark.parametrize("case", _RULES, ids=[c["input"] or "blank" for c in _RULES])
def test_impa_code_matches_validate(case: dict[str, object]) -> None:
    raw = str(case["input"])
    got = impa_code(raw)
    if not case["valid"]:
        assert got == raw.strip()
    elif case["code"] == "":
        assert got is None
    else:
        assert got == case["code"]


def test_impa_code_none() -> None:
    assert impa_code(None) is None
