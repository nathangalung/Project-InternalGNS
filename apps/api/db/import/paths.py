"""Where the import reads and writes.

Nothing derived from the source files is committed (the repository is
public). Generated files go to out/, the hand-made decision files live in
local/, and the seed SQL is written next to the other seeds; all three
are gitignored and exist only on the operator's machine, which must back
up local/ (it holds decisions nobody can regenerate).
"""

from __future__ import annotations

import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]

# Generated: rebuilt by the pipeline from Data/ and local/.
OUT_DIR = HERE / "out"
STAGED_FILE = OUT_DIR / "staged.json"
PRODUCTS_FILE = OUT_DIR / "products.json"
POS_FILE = OUT_DIR / "pos.json"
INVOICES_FILE = OUT_DIR / "invoices.json"

# Hand-made decisions about the source files.
LOCAL_DIR = HERE / "local"
OVERRIDES_FILE = LOCAL_DIR / "overrides.json"
VENDOR_OVERRIDES_FILE = LOCAL_DIR / "vendor_overrides.json"
ENRICHMENT_FILE = LOCAL_DIR / "impa_enrichment.json"
MANIFEST_FILE = LOCAL_DIR / "docs_manifest.py"

SEED_FILE = HERE.parent / "seeds" / "03_historical.sql"


def data_dir() -> Path:
    """The source files' root: GNS_DATA_DIR, else <repo>/Data/Data."""
    return Path(os.environ.get("GNS_DATA_DIR", str(REPO / "Data" / "Data")))
