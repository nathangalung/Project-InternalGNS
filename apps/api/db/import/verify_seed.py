"""Verify a database loaded with the historical seed.

Usage: uv run verify_seed.py [DSN]   (default: $DATABASE_URL)

Rebuilds the seed model from the inputs (no database needed for that)
and checks the database against it and against the app's own functions,
inside one transaction that is rolled back, so nothing is written:

- every quotation's stored totals equal fn_recompute_quotation_totals;
- every invoice's stored amounts equal invoices.json, and its lines sum
  to its header;
- every document number has the new format, and a base number carries
  its own document's month and year;
- doc_counters is at or above the highest loaded number of each type;
- a PO in ON_PROGRESS or DELIVERED without a PO number has a reason in
  pos.json, and every PO product line is priced above zero;
- every offered line of an accepted quotation has its product and unit;
- each quotation's, PO's and invoice's status is its last history move;
- an imported invoice is paid exactly when dated before PAID_BEFORE,
  with paid_at at its paid move as the model dates it, else sent;
- every imported document keeps the number it was issued under
  (legacy_no, legacy_dn_no), and every invoice's buyer is the one it
  prints (what it left blank may come from the client the replacement
  carried);
- rows per table equal the build report; master tables the replacement
  carries user data into may hold more.

Prints every check with PASS or FAIL and the failing rows; exits 1 on
any failure. Runs psql, so no database driver is needed.
"""

from __future__ import annotations

import csv
import io
import os
import subprocess
import sys
from collections import defaultdict

from build_seed import table_counts
from seed_model import PAID_BEFORE, ROMAN, Model, SeedError, build, dec, load_inputs
from seed_sql import lit

ROMAN_RE = "(" + "|".join(ROMAN) + ")"
NUMBER_RE = {
    "Q": f"^Q-[0-9]{{5,}}/GNS/{ROMAN_RE}/[0-9]{{4}}( Rev\\.[0-9]+)?$",
    "INV": f"^INV-[0-9]{{5,}}/GNS/{ROMAN_RE}/[0-9]{{4}}$",
    "DN": f"^DN-[0-9]{{5,}}/GNS/{ROMAN_RE}/[0-9]{{4}}$",
}

# Master tables replace_business_data.sql may carry user rows into.
CARRIED = (
    "company_client",
    "company_contacts",
    "vendors",
    "items",
    "vendor_products",
    "item_images",
)

TOTAL_COLS = (
    "total_produk",
    "total",
    "total_discount",
    "dpp_nilai_lain",
    "ppn_amount",
    "grand_total",
)


def values(rows: list[tuple[object, ...]], names: str) -> str:
    body = ",\n".join("(" + ", ".join(lit(v) for v in r) + ")" for r in rows)
    return f"(VALUES {body}) AS e({names})"


def period(day: str) -> str:
    """'/<Roman>/<YYYY>' of a date expression."""
    return (
        f"'/' || fn_month_to_roman(EXTRACT(MONTH FROM {day})::int)"
        f" || '/' || EXTRACT(YEAR FROM {day})::int"
    )


def columns(alias: str) -> str:
    return ", ".join(f"{alias}.{c}" for c in TOTAL_COLS)


def checks(model: Model) -> list[tuple[str, str]]:
    """(name, query returning one text column per failing row)."""
    inputs = load_inputs()
    by_original = {inv.original: inv for inv in model.invoices}
    expected_inv = [
        (
            by_original[d["invoice_number"]].number,
            dec(d["discount"]),
            dec(d["dpp"]),
            dec(d["ppn"]),
            dec(d["total"]),
        )
        for d in inputs.invoices
    ]
    reasons = [(po.id, po.missing_reason) for po in model.pos if po.missing_reason]
    reason_ids = values(reasons, "id, reason") if reasons else "(SELECT NULL::bigint) AS e(id)"
    q_seq = max(q.seq for q in model.quotations)
    counts = " UNION ALL ".join(
        f"SELECT {lit(t)} AS t, count(*) AS n, {n} AS want, {lit(t in CARRIED)} AS carried FROM {t}"
        for t, n in table_counts(model).items()
    )
    legacy_q = [(q.number, q.legacy) for q in model.quotations]
    legacy_inv = [(inv.number, inv.original) for inv in model.invoices]
    legacy_dn = [(po.id, po.dn_original) for po in model.pos]
    buyers = [
        (inv.number, inv.buyer_name, inv.buyer_npwp, inv.buyer_address) for inv in model.invoices
    ]
    paid = [(inv.number, inv.status, inv.paid_at) for inv in model.invoices]
    wib = "created_at AT TIME ZONE 'Asia/Jakarta'"
    return [
        (
            "quotation totals equal fn_recompute_quotation_totals",
            f"""
            SELECT q.quotation_no || ': stored (' || concat_ws(', ', {columns("s")})
                   || ') recomputed (' || concat_ws(', ', {columns("q")}) || ')'
            FROM verify_snap s JOIN quotations q USING (id)
            WHERE ({columns("s")}) IS DISTINCT FROM ({columns("q")})""",
        ),
        (
            "invoice amounts equal invoices.json",
            f"""
            SELECT coalesce(i.invoice_no, e.no)
                   || ': stored (' || concat_ws(', ', i.total_discount, i.dpp, i.ppn_amount,
                   i.total) || ') printed (' || concat_ws(', ', e.disc, e.dpp, e.ppn, e.total)
                   || ')'
            FROM {values(expected_inv, "no, disc, dpp, ppn, total")}
            FULL JOIN invoices i ON i.invoice_no = e.no
            WHERE (i.total_discount, i.dpp, i.ppn_amount, i.total) IS DISTINCT FROM
                  (e.disc::numeric, e.dpp::numeric, e.ppn::numeric, e.total::numeric)""",
        ),
        (
            "invoice lines sum to the header",
            """
            SELECT i.invoice_no || ': lines dpp ' || sum(l.dpp) || ' ppn ' || sum(l.ppn_amount)
                   || ', header subtotal ' || i.subtotal || ' ppn ' || i.ppn_amount
            FROM invoices i JOIN invoice_items l ON l.invoice_id = i.id
            GROUP BY i.id
            HAVING sum(l.dpp) <> i.subtotal OR sum(l.ppn_amount) <> i.ppn_amount
                OR sum(l.dpp_nilai_lain) <> i.dpp_nilai_lain""",
        ),
        (
            "quotation numbers have the new format",
            f"""
            SELECT quotation_no FROM quotations WHERE quotation_no !~ {lit(NUMBER_RE["Q"])}
            UNION ALL
            SELECT quotation_no || ' is not dated ' || ({wib})::date FROM quotations
            WHERE version = 1 AND quotation_no NOT LIKE '%' || {period(wib)}""",
        ),
        (
            "invoice numbers have the new format",
            f"""
            SELECT invoice_no FROM invoices
            WHERE invoice_no !~ {lit(NUMBER_RE["INV"])}
               OR invoice_no NOT LIKE '%' || {period("invoice_date")}""",
        ),
        (
            "delivery-note numbers have the new format",
            f"""
            SELECT coalesce(delivery_note_number, '(none) on PO ' || id) FROM purchase_orders
            WHERE status IN ('ON_PROGRESS', 'DELIVERED')
              AND (delivery_note_number IS NULL
                   OR delivery_note_number !~ {lit(NUMBER_RE["DN"])}
                   OR delivery_note_number NOT LIKE '%' || {period("delivery_note_date")})""",
        ),
        (
            "doc_counters at or above the highest loaded number",
            f"""
            SELECT doc_type || ' counter ' || last_seq || ', highest loaded ' || hi
            FROM doc_counters JOIN (
              SELECT 'Q' AS t, max(substring(quotation_no FROM '^Q-([0-9]+)')::int) AS hi
              FROM quotations
              UNION ALL
              SELECT 'INV', max(substring(invoice_no FROM '^INV-([0-9]+)')::int) FROM invoices
              UNION ALL
              SELECT 'DN', max(substring(delivery_note_number FROM '^DN-([0-9]+)')::int)
              FROM purchase_orders
            ) m ON m.t = doc_type
            WHERE last_seq < coalesce(hi, 0) OR (doc_type = 'Q' AND hi <> {q_seq})""",
        ),
        (
            "POs at work without a PO number have a reason in pos.json",
            f"""
            SELECT 'PO ' || p.id || ' (' || p.status || ', ' || q.quotation_no
                   || ') has no PO number and no reason'
            FROM purchase_orders p JOIN quotations q ON q.id = p.quotation_id
            WHERE p.status IN ('ON_PROGRESS', 'DELIVERED') AND p.po_number IS NULL
              AND p.id NOT IN (SELECT e.id::bigint FROM {reason_ids})""",
        ),
        (
            "status equals the last history move",
            """
            SELECT q.quotation_no || ': ' || q.status || ' but history ends ' || h.to_status
            FROM quotations q JOIN LATERAL (
              SELECT to_status FROM quotation_status_history
              WHERE quotation_id = q.id ORDER BY changed_at DESC, id DESC LIMIT 1
            ) h ON TRUE
            WHERE h.to_status <> q.status
            UNION ALL
            SELECT 'PO ' || p.id || ': ' || p.status || ' but history ends ' || h.to_status
            FROM purchase_orders p JOIN LATERAL (
              SELECT to_status FROM po_status_history
              WHERE po_id = p.id ORDER BY changed_at DESC, id DESC LIMIT 1
            ) h ON TRUE
            WHERE h.to_status <> p.status""",
        ),
        (
            "invoice status equals the last history move",
            """
            SELECT i.invoice_no || ': ' || i.status || ' but history ends ' || h.to_status
            FROM invoices i JOIN LATERAL (
              SELECT to_status FROM invoice_status_history
              WHERE invoice_id = i.id ORDER BY changed_at DESC, id DESC LIMIT 1
            ) h ON TRUE
            WHERE h.to_status <> i.status""",
        ),
        (
            f"paid exactly where invoice_date is before {PAID_BEFORE}, at its paid move",
            f"""
            SELECT coalesce(i.invoice_no, e.no) || ': ' || coalesce(i.status, '-')
                   || ' paid_at ' || coalesce(i.paid_at::text, '-')
                   || ', model ' || e.status || ' paid_at ' || coalesce(e.paid_at, '-')
            FROM {values(paid, "no, status, paid_at")}
            FULL JOIN invoices i ON i.invoice_no = e.no
            WHERE (i.status, i.paid_at) IS DISTINCT FROM (e.status, e.paid_at::timestamptz)
            UNION ALL
            SELECT i.invoice_no || ': ' || i.status || ', dated ' || i.invoice_date
            FROM invoices i
            WHERE i.legacy_no IS NOT NULL
              AND (i.status = 'paid') <> (i.invoice_date < {lit(PAID_BEFORE)}::date)
            UNION ALL
            SELECT i.invoice_no || ': paid_at ' || i.paid_at || ', paid move ' || h.at
            FROM invoices i JOIN LATERAL (
              SELECT max(changed_at) AS at FROM invoice_status_history
              WHERE invoice_id = i.id AND to_status = 'paid'
            ) h ON TRUE
            WHERE i.status = 'paid' AND i.paid_at IS DISTINCT FROM h.at""",
        ),
        (
            "every PO product line is priced above zero",
            """
            SELECT 'PO ' || po_id || ' line ' || line_number || ': ' || item_name
            FROM purchase_order_items
            WHERE item_type = 'product' AND selling_price <= 0""",
        ),
        (
            "every offered line of an accepted quotation has a product and a unit",
            """
            SELECT q.quotation_no || ' line ' || l.line_number
            FROM quotation_items l JOIN quotations q ON q.id = l.quotation_id
            WHERE q.status = 'accepted' AND l.item_type = 'product' AND l.is_available
              AND (l.offered_item_id IS NULL OR l.unit_id IS NULL)""",
        ),
        (
            "accepted exactly where a PO exists",
            """
            SELECT quotation_no || ': ' || status FROM quotations q
            WHERE (status = 'accepted')
               <> EXISTS (SELECT 1 FROM purchase_orders p WHERE p.quotation_id = q.id)""",
        ),
        (
            "documents keep the numbers they were issued under",
            f"""
            SELECT coalesce(q.quotation_no, e.no) || ': legacy_no ' || coalesce(q.legacy_no, '-')
                   || ', issued as ' || coalesce(e.legacy, '-')
            FROM {values(legacy_q, "no, legacy")}
            FULL JOIN quotations q ON q.quotation_no = e.no
            WHERE q.legacy_no IS DISTINCT FROM e.legacy
            UNION ALL
            SELECT coalesce(i.invoice_no, e.no) || ': legacy_no ' || coalesce(i.legacy_no, '-')
                   || ', issued as ' || coalesce(e.legacy, '-')
            FROM {values(legacy_inv, "no, legacy")}
            FULL JOIN invoices i ON i.invoice_no = e.no
            WHERE i.legacy_no IS DISTINCT FROM e.legacy
            UNION ALL
            SELECT 'PO ' || coalesce(p.id, e.id::bigint) || ': legacy_dn_no '
                   || coalesce(p.legacy_dn_no, '-') || ', printed DO ' || coalesce(e.legacy, '-')
            FROM {values(legacy_dn, "id, legacy")}
            FULL JOIN purchase_orders p ON p.id = e.id::bigint
            WHERE p.legacy_dn_no IS DISTINCT FROM e.legacy""",
        ),
        (
            "invoice buyers are the printed buyers",
            f"""
            SELECT coalesce(i.invoice_no, e.no) || ': buyer ' || coalesce(i.buyer_name, '-')
                   || ', printed ' || coalesce(e.name, '-')
            FROM {values(buyers, "no, name, npwp, address")}
            FULL JOIN invoices i ON i.invoice_no = e.no
            WHERE i.buyer_name IS DISTINCT FROM e.name
               OR (e.address IS NOT NULL AND i.buyer_address IS DISTINCT FROM e.address)
               OR (e.npwp IS NOT NULL AND i.buyer_npwp IS DISTINCT FROM e.npwp)""",
        ),
        (
            "rows per table equal the build report",
            f"""
            SELECT t || ': ' || n || ' rows, report says ' || want FROM ({counts}) c
            WHERE n <> want AND NOT (carried AND n > want)""",
        ),
        (
            "info: rows carried over beyond the build report",
            f"""
            SELECT t || ': ' || n - want || ' more' FROM ({counts}) c
            WHERE carried AND n > want""",
        ),
        (
            "info: POs without a client PO number",
            f"""
            SELECT 'PO ' || p.id || ' ' || q.quotation_no || ' ' || p.status || ': ' || e.reason
            FROM {reason_ids}
            JOIN purchase_orders p ON p.id = e.id::bigint
            JOIN quotations q ON q.id = p.quotation_id""",
        ),
    ]


def script(model: Model) -> str:
    snap = ", ".join(TOTAL_COLS)
    parts = [
        "BEGIN;",
        "CREATE TEMP TABLE verify_result (seq int, name text, detail text);",
        f"CREATE TEMP TABLE verify_snap AS SELECT id, {snap} FROM quotations;",
        "DO $$ BEGIN PERFORM fn_recompute_quotation_totals(id) FROM quotations; END $$;",
    ]
    for i, (name, query) in enumerate(checks(model)):
        parts.append(f"INSERT INTO verify_result SELECT {i}, {lit(name)}, d FROM ({query}) x(d);")
        parts.append(f"INSERT INTO verify_result VALUES ({i}, {lit(name)}, NULL);")
    parts += [
        "\\pset format csv",
        "\\pset tuples_only on",
        "SELECT seq, name, detail FROM verify_result ORDER BY seq, detail NULLS FIRST;",
        "ROLLBACK;",
    ]
    return "\n".join(parts) + "\n"


def run(dsn: str, model: Model) -> int:
    proc = subprocess.run(
        ["psql", dsn, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"],
        input=script(model),
        capture_output=True,
        text=True,
        check=False,
        env={**os.environ, "PGCLIENTENCODING": "UTF8"},
    )
    if proc.returncode != 0:
        print(proc.stderr, file=sys.stderr)
        print("verify_seed: psql failed", file=sys.stderr)
        return 1
    results: dict[tuple[int, str], list[str]] = defaultdict(list)
    for seq, name, detail in csv.reader(io.StringIO(proc.stdout)):
        found = results.setdefault((int(seq), name), [])
        if detail:
            found.append(detail)
    failed = 0
    for (_, name), details in sorted(results.items()):
        info = name.startswith("info:")
        if info:
            print(f"INFO {name[5:].strip()}: {len(details)}")
        elif details:
            failed += 1
            print(f"FAIL {name}: {len(details)}")
        else:
            print(f"PASS {name}")
        for d in details:
            print(f"     {d}")
    print(f"verify_seed: {'FAILED' if failed else 'all checks passed'} ({failed} failing)")
    return 1 if failed else 0


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    dsn = args[0] if args else os.environ.get("DATABASE_URL", "")
    if not dsn:
        print("usage: verify_seed.py DSN (or set DATABASE_URL)", file=sys.stderr)
        return 2
    try:
        model = build()
    except SeedError as exc:
        print(f"verify_seed: {exc}", file=sys.stderr)
        return 1
    return run(dsn, model)


if __name__ == "__main__":
    sys.exit(main())
