"""Apply goose migrations directly via psql when goose CLI is unavailable.

Strips goose pragma comments and runs each Up section in order. Tracks state
in a `goose_db_version` table that mirrors what goose itself manages.
"""
from __future__ import annotations
import os
import re
import subprocess
import sys
from pathlib import Path


MIGRATIONS_DIR = Path(r"D:\quotation\Project-InternalGNS\apps\api\db\migrations")

DSN_HOST = os.environ.get("PGHOST", "localhost")
DSN_USER = os.environ.get("PGUSER", "gns_app")
DSN_PASS = os.environ.get("PGPASSWORD", "gns_app")
DSN_DB = os.environ.get("PGDATABASE", "gns_quotation")


def extract_up(sql: str) -> str:
    """Return only the Up section, with goose pragma comments stripped."""
    lines = sql.splitlines()
    out: list[str] = []
    in_up = False
    for ln in lines:
        stripped = ln.strip()
        if stripped == "-- +goose Up":
            in_up = True
            continue
        if stripped == "-- +goose Down":
            in_up = False
            continue
        if not in_up:
            continue
        if stripped in ("-- +goose StatementBegin", "-- +goose StatementEnd"):
            continue
        out.append(ln)
    return "\n".join(out)


def run_psql(sql: str) -> tuple[int, str, str]:
    env = os.environ.copy()
    env["PGPASSWORD"] = DSN_PASS
    env["PGCLIENTENCODING"] = "UTF8"
    # Bytes mode + explicit UTF-8 — text=True on Windows defaults to cp1252,
    # which corrupts characters like × (U+00D7).
    proc = subprocess.run(
        ["psql", "-U", DSN_USER, "-h", DSN_HOST, "-d", DSN_DB,
         "-v", "ON_ERROR_STOP=1", "-q"],
        input=sql.encode("utf-8"),
        capture_output=True,
        env=env,
    )
    return (proc.returncode,
            proc.stdout.decode("utf-8", errors="replace"),
            proc.stderr.decode("utf-8", errors="replace"))


def ensure_version_table():
    rc, _, err = run_psql("""
        CREATE TABLE IF NOT EXISTS goose_db_version (
            id SERIAL PRIMARY KEY,
            version_id BIGINT NOT NULL,
            is_applied BOOLEAN NOT NULL,
            tstamp TIMESTAMP DEFAULT NOW()
        );
        INSERT INTO goose_db_version (version_id, is_applied)
        SELECT 0, TRUE
        WHERE NOT EXISTS (SELECT 1 FROM goose_db_version WHERE version_id = 0);
    """)
    if rc != 0:
        print("Failed to ensure goose_db_version:", err)
        sys.exit(1)


def applied_versions() -> set[int]:
    rc, out, err = run_psql("SELECT version_id FROM goose_db_version WHERE is_applied;")
    if rc != 0:
        return set()
    return {int(line.strip()) for line in out.splitlines() if line.strip().isdigit()}


def mark_applied(version: int):
    rc, _, err = run_psql(
        f"INSERT INTO goose_db_version (version_id, is_applied) VALUES ({version}, TRUE);"
    )
    if rc != 0:
        print(f"Failed to mark v{version} applied:", err)
        sys.exit(1)


def main():
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    print(f"Found {len(files)} migration files")

    ensure_version_table()
    done = applied_versions()
    print(f"Already applied: {sorted(done)}")

    for fp in files:
        m = re.match(r"^(\d+)_", fp.name)
        if not m:
            continue
        version = int(m.group(1))
        if version in done:
            print(f"  [skip]  {fp.name}")
            continue
        sql = extract_up(fp.read_text(encoding="utf-8"))
        if not sql.strip():
            print(f"  [empty] {fp.name}")
            continue
        print(f"  [apply] {fp.name} ... ", end="", flush=True)
        rc, out, err = run_psql(sql)
        if rc != 0:
            print("FAILED")
            print(err)
            sys.exit(1)
        mark_applied(version)
        print("ok")

    print("\nAll migrations applied.")


if __name__ == "__main__":
    main()
