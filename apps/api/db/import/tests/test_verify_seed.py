"""The verification script renders for a synthetic model (no database)."""

from __future__ import annotations

import pytest

import verify_seed
from helpers import inputs, invoice_doc, line, po_doc, staged
from seed_model import build


def test_every_check_is_one_insert_inside_a_rolled_back_transaction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rec = staged("a.xlsx#S", "Q-1/GNS/I/2026", "2026-10-01", [line(1, 1000)])
    po = po_doc(rec, [{"no": 1, "qty": 1, "unit_price": 1000, "quote_row": 15}])
    data = inputs([rec], [po], [invoice_doc(po, "1/INV", "2026-10-02")])
    monkeypatch.setattr(verify_seed, "load_inputs", lambda: data)
    model = build(data)
    sql = verify_seed.script(model)
    names = [name for name, _ in verify_seed.checks(model)]
    assert "every PO product line is priced above zero" in names
    assert "invoice buyers are the printed buyers" in names
    assert sql.startswith("BEGIN;") and sql.rstrip().endswith("ROLLBACK;")
    assert sql.count("INSERT INTO verify_result SELECT") == len(names)
    assert "'INV-00001/GNS/X/2026'" in sql


def test_main_needs_a_dsn(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert verify_seed.main([]) == 2
