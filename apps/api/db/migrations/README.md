# Database — goose migrations

Canonical schema source for InternalGNS. The Go binary embeds this folder and
applies pending migrations automatically on boot.

## Layout

```
migrations/
├── 00001_baseline_schema.sql     # initial DDL (promoted from legacy db/01_schema.sql)
├── NNNNN_<name>.sql              # subsequent changes; never edit an applied file
├── seeds/
│   ├── 01_master.sql             # master data (users, units, clients, items, vendors)
│   └── 02_dev_samples.sql        # sample transactions for dev/staging ONLY
└── checks/
    └── 01_verify_advanced.sql    # ad-hoc verification queries
```

## Rules

- **Files are immutable once applied anywhere.** To change schema, add a new
  timestamped migration — never edit `00001_baseline_schema.sql`.
- **Wrap PL/pgSQL in `-- +goose StatementBegin` / `-- +goose StatementEnd`.**
  Goose splits by `;`, which breaks function bodies.
- **Seeds and checks are NOT run by goose.** They're invoked via
  `apps/api/Makefile` targets (`make seed-dev`, `make check-reconcile`).

## Commands

```bash
make -C apps/api migrate-up        # apply pending
make -C apps/api migrate-status    # list applied/pending
make -C apps/api migrate-down      # roll back last
make -C apps/api migrate-new NAME=add_payments
make -C apps/api seed-dev          # DEV ONLY — loads seeds/*.sql
make -C apps/api check-reconcile   # runs checks/01_verify_advanced.sql
```

Defaults to `$DATABASE_URL` in the env; override per environment.

## Prod behavior

On production (Dokploy), the API container runs `goose.Up` on startup via
the embedded migrations in `internal/shared/db/migrate.go`. Seeds are
**never** applied in production.

## Baseline schema notes

The baseline (`00001_baseline_schema.sql`) includes:

- `pg_trgm` extension for fuzzy item matching.
- GENERATED STORED columns on headers/items for computed totals
  (`total`, `subtotal`, `dpp_nilai_lain`, `ppn_amount`, `grand_total`,
  `profit_amount`, `profit_pct`).
- `row_version` trigger for optimistic locking.
- CHECK constraints on enum-like VARCHAR fields (`status`, `role`, ...).
- `quotation_reconciliation` view for drift detection
  (`SUM(items.total_selling) == header.total`).
- Snapshot fields (`company_client_name`, `invoice_items.item_name`, ...)
  are **intentionally not FK** — historical documents stay frozen even if
  master data changes.
- Application DB: `gns_quotation`, application user: `gns_app`.

## Local setup without Docker

If you prefer a native Postgres:

```sql
CREATE DATABASE gns_quotation;
CREATE USER gns_app WITH PASSWORD 'change_me';
GRANT ALL PRIVILEGES ON DATABASE gns_quotation TO gns_app;
```

Then `make -C apps/api migrate-up` and `make -C apps/api seed-dev`.
