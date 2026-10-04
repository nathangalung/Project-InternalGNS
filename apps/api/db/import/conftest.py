"""Run tests_local/ only where the source files are."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

LOCAL_TESTS = Path(__file__).resolve().parent / "tests_local"


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    """Skip every tests_local/ test without GNS_DATA_DIR."""
    if os.environ.get("GNS_DATA_DIR"):
        return
    skip = pytest.mark.skip(reason="tests_local/ needs GNS_DATA_DIR (the source files)")
    for item in items:
        if LOCAL_TESTS in Path(str(item.fspath)).parents:
            item.add_marker(skip)
