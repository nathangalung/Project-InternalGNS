"""Unit tests for the parse.py run helpers."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from helpers import save_workbook
from parse import dump_staged, resolve_vessels, run

Record = dict[str, Any]


def _rec(vessel: str | None, source: str | None, candidates: list[str], parts: list[str]) -> Record:
    return {
        "vessel": vessel,
        "vessel_source": source,
        "vessel_candidates": candidates,
        "file_name": {"parts": parts},
    }


def test_resolve_vessels_canonical_spelling_and_bare_names() -> None:
    a = _rec("MV YUXIN SATU", "print", [], [])
    b = _rec("MV Yuxin Satu", "print", [], [])
    c = _rec("SHIP: MV YUXIN SATU", "print", [], [])
    d = _rec(None, None, ["Note: Material NBR", "Yuxin Satu"], ["Bolt", "Yuxin Satu"])
    e = _rec(None, None, ["Stock Office"], ["Hallite 30 45"])
    c["vessel"] = "MV YUXIN SATU"
    resolve_vessels([a, b, c, d, e])
    assert [r["vessel"] for r in (a, b, c, d, e)] == ["MV YUXIN SATU"] * 4 + [None]
    assert (b["vessel_raw"], d["vessel_raw"], d["vessel_source"]) == (
        "MV Yuxin Satu",
        "Yuxin Satu",
        "file",
    )
    assert (d["topic"], e["topic"]) == ("Bolt", "Hallite 30 45")
    assert "vessel_candidates" not in a


def test_dump_staged_is_json_with_one_item_per_line() -> None:
    staged = {"source_root": "x", "quotations": [{"id": "a"}, {"id": "b"}], "excluded_files": []}
    text = dump_staged(staged)
    assert json.loads(text) == staged
    assert '{"id": "a"},\n{"id": "b"}' in text


def test_run_accounts_for_every_file(tmp_path: Path) -> None:
    root = tmp_path / "Quotation" / "Quotation 2025 - Excel"
    save_workbook(
        root / "Q-951001 (Accu GS N200) - Karunia Aman Selalu.xlsx",
        {
            "DATA ENTRI": {
                "A2": "Customer", "D2": "PT. KARUNIA AMAN SELALU",
                "A3": "No", "D3": "Q-951001/GNS/I/2025",
                "A4": "Tgl", "D4": "Jakarta, 07 January 2025",
                "A11": "No.", "B11": "Qty", "C11": "Unit", "D11": "D E S C R I P T I O N",
                "G11": "Harga Jual", "I11": "Modal",
                "G12": "Unit Price", "H12": "Amount", "I12": "Unit Price", "J12": "Amount",
                "A15": 1, "B15": 2, "C15": "pcs", "D15": "ACCU GS N200", "G15": 4600000,
                "H15": 9200000, "I15": 3500000, "J15": 7000000,
            },
        },
    )  # fmt: skip
    (root / "~$Q-951001 (Accu GS N200) - Karunia Aman Selalu.xlsx").write_bytes(b"lock")
    save_workbook(root / "Lumoso.xlsx", {"Sheet1": {"A1": "NO", "B1": "Request Items"}})
    staged, report = run(tmp_path, tmp_path / "no-oracles")
    (q,) = staged["quotations"]
    assert q["client"]["name"] == "PT. Karunia Aman Selalu"
    assert q["computed_totals"]["grand"] == 10212000.0  # 12% of DPP 11/12
    assert sorted(e["reason"] for e in staged["excluded_files"]) == [
        "lock file",
        "not a quotation (no DATA ENTRI sheet and no quotation print sheet)",
    ]
    assert "| .xlsx files found (recursive) | 3 |" in report
    assert "pdf.tsv not found" in report
