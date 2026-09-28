# Tech stack

The pinned baseline. Bump only in a PR that touches this file plus the
matching `go.mod`, `package.json`, `Dockerfile`, or compose file.

## Backend (`apps/api`)

| What | Version | Pinned in |
|---|---|---|
| Go | 1.27.1 | `go.mod`, `apps/api/Dockerfile` (`golang:1.27.1-alpine`) |
| golangci-lint | v2.14 | `.github/workflows/ci.yml` (`golangci-lint-action` `version`) |
| Postgres | 18.6-alpine | `compose.dev.yml`, `compose.prod.yml`, `.github/workflows/ci.yml` |
| chi router | v5.3.2 | `go.mod` |
| pgx | v5.11.0 | `go.mod` |
| goose (embedded, and the CLI `make setup` installs) | v3.28.0 | `go.mod`, `Makefile` |
| golang-jwt | v5.3.1 | `go.mod` |
| minio-go | v7.3.0 | `go.mod` |
| excelize | v2.11.0 | `go.mod` |
| coder/guts (web API type generator, `cmd/gentypes`) | v1.7.1 | `go.mod` |
| shopspring/decimal | v1.4.0 | `go.mod` |
| bcrypt | `golang.org/x/crypto` | `go.mod` |

Runtime image: `debian:bookworm-slim` with the TeX Live packages xelatex
needs, running as a non-root user. The container healthcheck runs the binary
with `-healthcheck`, which probes `/readyz`.

SQL is hand-written in `db/queries`; there is no code generator.

## Frontend (`apps/web`)

| What | Version | Pinned in |
|---|---|---|
| Bun (package manager) | 1.4.2 | `package.json` `packageManager`, `apps/web/Dockerfile` |
| Node (runtime floor) | >=24.0.0 | `package.json` `engines.node` |
| Node (CI) | 24 (LTS line) | `.github/workflows/ci.yml` `setup-node` |
| TypeScript | ^7.0.2 | `package.json` |
| React / react-dom | ^19.3.0 | `package.json` |
| Vite | ^8.3.1 | `package.json` |
| Tailwind CSS | ^4.3.3 | `package.json` |
| TanStack Router | ^1.170.39 | `package.json` |
| TanStack Query | ^5.103.3 | `package.json` |
| Biome | ^2.5.14 | `package.json` |
| Vitest | ^5.0.2 | `package.json` |
| Playwright | ^1.63.0 | `package.json` |

Caret ranges are intentional; exact versions are pinned by `bun.lock`. CI runs
`bun install --frozen-lockfile` to refuse drift. The production image serves
the build from `nginx:1.30.5-alpine` (the stable branch).

## Infra

| What | Version | Pinned in |
|---|---|---|
| Docker Compose schema | v2 (no `version:` key) | `compose.dev.yml`, `compose.prod.yml` |
| MinIO server (Silo fork) | `pgsty/silo:RELEASE.2026-09-16T00-00-00Z` | `compose.dev.yml`, `compose.prod.yml`, `.github/workflows/ci.yml` |
| pgweb (dev only) | `sosedoff/pgweb:0.17.0` | `compose.dev.yml` |
| Dokploy | follow upstream stable | external |
| Traefik | provided by Dokploy | external |

## Tooling

| What | Version | Pinned in |
|---|---|---|
| pre-commit (installed by `make hooks-install`) | 4.6.2 | `Makefile` |
| pre-commit-hooks | v6.0.0 | `.pre-commit-config.yaml` |
| tbls (installed by `make db-erd`) | v1.96.0 | `Makefile` |
| uv (db/import tool) | >=0.12.19 | `apps/api/db/import/pyproject.toml` (`required-version`) |
| Python (db/import tool) | 3.14 | `apps/api/db/import/.python-version` |
| openpyxl | 3.1.5 | `apps/api/db/import/uv.lock` |

GitHub Actions in `.github/workflows` are pinned by full commit SHA with the
release as a trailing comment (`@<sha> # v7.0.1`); Dependabot's
`github-actions` ecosystem bumps both together.

Container base images (both Dockerfiles, both compose files, and the CI
postgres and Silo containers) are pinned as `name:tag@sha256:<digest>`, where
the digest is the multi-arch index, not one platform's manifest, so arm64
hosts still pull. Resolve a new one with
`docker buildx imagetools inspect <name:tag> --format '{{json .Manifest.Digest}}'`.
Dependabot's `docker` (Dockerfiles) and `docker-compose` (compose files)
ecosystems move tag and digest together. No ecosystem reads workflow
images, so `ci.yml` copies the `compose.dev.yml` pins and its first backend
step fails until they match.

## Bumping policy

- **Patch / minor**: update the lock files (`go.sum`, `bun.lock`), run
  `make test`, `make e2e` and the PDF layout tests, ship.
- **Major**: pair the bump with a note in `docs/decisions/`. Re-run
  `make reset && make seed-dev` on a fresh volume and walk a quotation through
  to an invoice.
- **Postgres major**: needs `pg_upgrade` or a dump and restore of the
  production volume (see `backup_restore.md`). Schedule a maintenance window.
