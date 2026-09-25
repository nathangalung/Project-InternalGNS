# Tech stack

The pinned baseline. Bump only in a PR that touches this file plus the
matching `go.mod`, `package.json`, `Dockerfile`, or compose file.

## Backend (`apps/api`)

| What | Version | Pinned in |
|---|---|---|
| Go | 1.26.8 | `go.mod`, `apps/api/Dockerfile` (`golang:1.26.8-alpine`) |
| Postgres | 18.3-alpine | `compose.dev.yml`, `compose.prod.yml` |
| chi router | v5.2.5 | `go.mod` |
| pgx | v5.9.2 | `go.mod` |
| goose (embedded, and the CLI `make setup` installs) | v3.27.1 | `go.mod`, `Makefile` |
| golang-jwt | v5.3.1 | `go.mod` |
| minio-go | v7.1.0 | `go.mod` |
| excelize | v2.11.0 | `go.mod` |
| shopspring/decimal | v1.4.0 | `go.mod` |
| bcrypt | `golang.org/x/crypto` | `go.mod` |

Runtime image: `debian:bookworm-slim` with the TeX Live packages xelatex
needs, running as a non-root user. The container healthcheck runs the binary
with `-healthcheck`, which probes `/readyz`.

SQL is hand-written in `db/queries`; there is no code generator.

## Frontend (`apps/web`)

| What | Version | Pinned in |
|---|---|---|
| Bun (package manager) | 1.3.9 | `package.json` `packageManager`, `apps/web/Dockerfile` |
| Node (runtime floor) | >=22.0.0 | `package.json` `engines.node` |
| TypeScript | ^5.9.3 | `package.json` |
| React / react-dom | ^19.2.8 | `package.json` |
| Vite | ^7.3.6 | `package.json` |
| Tailwind CSS | ^4.3.3 | `package.json` |
| TanStack Router | ^1.170.18 | `package.json` |
| TanStack Query | ^5.101.4 | `package.json` |
| Biome | ^2.5.6 | `package.json` |
| Vitest | ^4.1.10 | `package.json` |
| Playwright | ^1.62.1 | `package.json` |
| exceljs (RFQ import) | ^4.4.0 | `package.json` |

Caret ranges are intentional; exact versions are pinned by `bun.lock`. CI runs
`bun install --frozen-lockfile` to refuse drift. The production image serves
the build from `nginx:1.31-alpine`.

## Infra

| What | Version | Pinned in |
|---|---|---|
| Docker Compose schema | v2 (no `version:` key) | `compose.dev.yml`, `compose.prod.yml` |
| MinIO | `RELEASE.2025-09-07T16-13-09Z` | `compose.dev.yml`, `compose.prod.yml` |
| Dokploy | follow upstream stable | external |
| Traefik | provided by Dokploy | external |

## Bumping policy

- **Patch / minor**: update the lock files (`go.sum`, `bun.lock`), run
  `make test`, `make e2e` and the PDF layout tests, ship.
- **Major**: pair the bump with a note in `docs/decisions/`. Re-run
  `make reset && make seed-dev` on a fresh volume and walk a quotation through
  to an invoice.
- **Postgres major**: needs `pg_upgrade` or a dump and restore of the
  production volume (see `backup_restore.md`). Schedule a maintenance window.
