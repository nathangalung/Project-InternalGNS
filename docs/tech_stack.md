# Tech stack

Locked baseline as of 2026-04-27. Bump only via PR that touches this file plus
the matching `go.mod`, `package.json`, `Dockerfile`, or compose.

## Backend (`apps/api`)

| What | Version | Pinned in |
|---|---|---|
| Go | 1.25.0 | `go.mod`, `apps/api/Dockerfile` (`golang:1.25-alpine`) |
| Postgres | 18-alpine | `compose.dev.yml`, `compose.prod.yml` |
| chi router | v5.1.0 | `go.mod` |
| pgx | v5 | `go.mod` |
| goose (embedded) | v3 | `go.mod` |
| sqlc CLI | v1.31 | `sqlc.yaml` (target) |
| bcrypt | `golang.org/x/crypto` | `go.mod` |

Build image: `gcr.io/distroless/static-debian12:nonroot` (no shell). Runtime
healthcheck is HTTP `/healthz` enforced by Traefik in production and by
`docker compose` `depends_on` in dev.

## Frontend (`apps/web`)

| What | Version | Pinned in |
|---|---|---|
| Bun (package manager) | 1.3.9 | `package.json` `packageManager` |
| Node (runtime floor) | >=22.0.0 | `package.json` `engines.node` |
| TypeScript | ^5.9.3 | `package.json` |
| React / react-dom | ^19.2.4 | `package.json` |
| Vite | ^7.3.1 | `package.json` |
| Tailwind | ^4.2.0 | `package.json` |
| TanStack Router | ^1.168.0 | `package.json` |
| TanStack Query | ^5.99.0 | `package.json` |
| Biome | ^2.4.12 | `package.json` |
| Zod | ^4.3.0 | `package.json` |

Caret ranges are intentional — exact versions are pinned by `bun.lock`. Run
`bun install --frozen-lockfile` in CI to refuse drift.

## Infra

| What | Version | Pinned in |
|---|---|---|
| Docker Compose schema | v2 (no `version:` key) | `compose.dev.yml`, `compose.prod.yml` |
| MinIO | latest (production only) | `compose.prod.yml` |
| Dokploy | follow upstream stable | external |
| Traefik | provided by Dokploy | external |

## Bumping policy

- **Patch / minor**: update lock files (`go.sum`, `bun.lock`), run the smoke
  matrix in `compose.dev.yml`, ship.
- **Major**: pair the bump with a migration note in `docs/decisions/`. Always
  re-run `make migrate-up && make seed-dev` against a fresh `compose.dev.yml`
  volume and confirm `/api/v1/quotations/{id}` round-trips.
- **Postgres major**: requires `pg_upgrade --link` against the
  `internalgns_pgdata` volume. Schedule a maintenance window.
