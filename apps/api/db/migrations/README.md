# Database migrations (goose)

The schema history for InternalGNS. The Go binary embeds this folder
(`migrations.go`) and applies pending migrations on every boot, under a
Postgres advisory lock so two instances cannot migrate at once
(`internal/shared/db/migrate.go`).

## Layout

```
db/
├── migrations/     00001_baseline_schema.sql, then NNNNN_<name>.sql
├── functions/      current body of every function, generated and drift-tested
├── queries/        named SQL the repos run
├── seeds/          master and historical data, loaded by make seed-dev (dev only)
├── checks/         verification queries for make check-reconcile
└── maintenance/    clean_test_data.sql for make db-clean-testdata
```

## Rules

- **Never edit an applied migration.** Add a new one.
- **Number order is apply order.** Goose runs without out-of-order, so it
  refuses a migration numbered below one a database has already applied. A
  new migration takes the next number above the highest on the branch
  (`make migrate-new` does this).
- **Retired numbers stay empty.** 00049, 00058 and 00060 were never merged.
  Do not reuse them; goose skips the gaps.
- **Wrap plpgsql in `-- +goose StatementBegin` / `-- +goose StatementEnd`.**
  Goose splits on `;` otherwise.
- **After changing a function, run `make db-functions-dump`** and commit the
  refreshed `db/functions/<name>.sql` with the migration. The drift test fails
  when the two disagree.
- **A new query key goes into `db/queries/required.go`** in the same commit.
- Seeds and checks are not goose migrations and never run in production.

## Commands

From the repo root:

```bash
make migrate                  # apply pending migrations and create the superadmin
make migrate-up               # raw goose up
make migrate-status           # applied and pending
make migrate-down             # roll back the last one (dev only)
make migrate-new NAME=add_x   # next numbered file
make db-functions-dump        # refresh db/functions from the dev database
make seed-dev                 # migrate, then load every seed (dev only)
make check-reconcile          # run checks/01_verify_advanced.sql
```

The goose targets use `DATABASE_URL`, which defaults to the dev database.

## Production

The API container migrates forward on boot; no deploy runs a down migration.
Rollback and the pre-deploy checks are in `docs/deploy_vps.md`.

## Baseline notes

`00001_baseline_schema.sql` and its successors rely on:

- `pg_trgm` for fuzzy item, client and vendor search.
- GENERATED STORED columns for line and header totals. The app never writes
  them.
- `row_version` triggers for optimistic locking.
- CHECK constraints on status and role columns, kept in step with the Go
  status lists.
- The `quotation_reconciliation` view, which compares line sums with header
  totals.
- Snapshot columns (`company_client_name`, `invoice_items.item_name`, ...)
  that are deliberately not foreign keys, so filed documents never change
  when master data does.
- Database `gns_quotation`, owner `gns_app`.
