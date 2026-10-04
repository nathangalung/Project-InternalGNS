"""build_seed refuses without its sources and writes the seed with them."""

from __future__ import annotations

from pathlib import Path

import pytest

import build_seed
from helpers import inputs, line, staged
from seed_model import build


@pytest.fixture
def sources(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """An empty Data/ and local/ under tmp_path."""
    monkeypatch.setattr(build_seed, "data_dir", lambda: tmp_path / "Data")
    local = [tmp_path / "local" / n for n in ("manifest.py", "overrides.json")]
    monkeypatch.setattr(build_seed, "LOCAL_INPUTS", tuple(local))
    monkeypatch.setattr(build_seed, "BUILD_INPUTS", (tmp_path / "out" / "staged.json",))
    monkeypatch.setattr(build_seed, "VENDOR_REVIEW_FILE", tmp_path / "out" / "review.csv")
    return tmp_path


def _fill(root: Path) -> None:
    for sub in build_seed.SOURCE_DIRS:
        (root / "Data" / sub).mkdir(parents=True)
    for p in build_seed.LOCAL_INPUTS:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("{}")


def test_it_names_every_missing_source(sources: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert build_seed.main(["--check-sources"]) == 1
    err = capsys.readouterr().err
    assert err.count("build_seed: missing") == len(build_seed.SOURCE_DIRS) + 2
    assert "never committed" in err
    _fill(sources)
    assert build_seed.main(["--check-sources"]) == 0
    assert build_seed.main([]) == 1
    assert "staged.json" in capsys.readouterr().err


def test_it_writes_the_seed_report_and_vendor_review(
    sources: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _fill(sources)
    out = sources / "out"
    out.mkdir()
    (out / "staged.json").write_text("{}")
    data = inputs(
        [staged("a.xlsx#S", "Q-1/GNS/I/2026", "2026-10-01", [line(1, 10, 5, vendor="Toko")])]
    )
    monkeypatch.setattr(build_seed, "build", lambda as_of: build(data, as_of))
    seed, report = sources / "seed.sql", out / "report.md"
    assert build_seed.main(["--seed", str(seed), "--report", str(report)]) == 0
    assert seed.read_text().startswith("-- HISTORICAL IMPORT")
    assert report.read_text().startswith("# Historical seed report")
    assert (out / "review.csv").read_text().startswith("vendor_a,")
