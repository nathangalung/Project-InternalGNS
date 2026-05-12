# P6 — Framework Currency Audit

Snapshot from `2026-05-13`. Sources: `bun pm view`, `go list -m -u all`,
`go.dev/dl`, `api.github.com/repos/<org>/<repo>/releases/latest`. Versions
on the right are upstream stable as of the snapshot date.

The plan rule (§5 round3): **no upgrade unless current pin is genuinely
behind**. This audit lists the gap; the upgrade trigger is a per-item
decision in the recommendation column.

## Toolchain (host + Dockerfile)

| Tool           | Pinned / Installed | Latest stable | Gap     | Recommendation                                                                |
| -------------- | ------------------ | ------------- | ------- | ----------------------------------------------------------------------------- |
| Go (toolchain) | host `1.26.1`      | `1.26.3`      | patch   | bump Dockerfile base to `golang:1.26.3-alpine`; `go.mod` `go 1.25` stays      |
| Go (`go.mod`)  | `1.25.0`           | `1.26.x` GA   | minor   | hold — `go.mod` directive ≠ runtime; bumping forces consumers to ≥1.26       |
| Bun            | host `1.3.9`       | `1.3.13`      | patch   | bump Dockerfile FROM tag; pin `engines.bun` in `apps/web/package.json`        |
| golangci-lint  | host `2.11.3`      | `2.12.2`      | patch   | bump in CI image + Dockerfile; no config break expected (still v2)            |
| uv             | host `0.11.11`     | recent        | -       | hold — used only to install pre-commit; tracks fast on its own                |

## API direct deps (`apps/api/go.mod`)

| Module                          | Pinned   | Latest   | Gap    | Recommendation                                              |
| ------------------------------- | -------- | -------- | ------ | ----------------------------------------------------------- |
| `jackc/pgx/v5`                  | `5.7.1`  | `5.9.2`  | minor  | bump — driver-only minor; CHANGELOG: BatchResults fixes     |
| `pressly/goose/v3`              | `3.23.0` | `3.27.1` | minor  | bump — embedded migration runner, low-risk                  |
| `go-chi/chi/v5`                 | `5.1.0`  | `5.2.5`  | minor  | bump — adds `RoutePattern` helpers; surface API stable      |
| `caarlos0/env/v11`              | `11.3.1` | `11.4.1` | patch  | bump — config parser, harmless                              |
| `golang-jwt/jwt/v5`             | `5.3.1`  | `5.3.1`  | —      | current                                                     |
| `cucumber/godog`                | `0.15.1` | `0.15.1` | —      | current                                                     |
| `minio/minio-go/v7`             | `7.1.0`  | `7.1.0`  | —      | current (already latest per `go list`)                      |
| `stretchr/testify`              | `1.11.1` | `1.11.1` | —      | current                                                     |
| `joho/godotenv`                 | `1.5.1`  | `1.5.1`  | —      | current                                                     |
| `google/uuid`                   | `1.6.0`  | `1.6.0`  | —      | current                                                     |
| `golang-jwt/jwt/v4` (indirect)  | `4.5.1`  | `4.5.2`  | patch  | will follow `go mod tidy` after direct-dep bumps            |

## FE deps (`apps/web/package.json`)

| Package                       | Pinned     | Latest     | Gap   | Recommendation                                                          |
| ----------------------------- | ---------- | ---------- | ----- | ----------------------------------------------------------------------- |
| `typescript`                  | `^5.9.3`   | `6.0.3`    | MAJOR | hold — TS 6 just shipped; wait one cycle for biome / TanStack to catch  |
| `vite`                        | `^7.3.1`   | `8.0.12`   | MAJOR | hold — Vite 8 needs plugin ecosystem verification; revisit next round   |
| `@biomejs/biome`              | `^2.4.12`  | `2.4.15`   | patch | bump — same v2 line, picked up via `^`                                  |
| `@tanstack/react-query`       | `^5.99.0`  | `5.100.10` | patch | bump — picked up automatically by lockfile refresh                      |
| `@tanstack/react-router`      | `^1.168.0` | `1.169.2`  | patch | bump — same                                                             |
| `@tanstack/router-cli`        | `^1.166.0` | `1.169.x`  | patch | sync to router version                                                  |
| `@tanstack/router-plugin`     | `^1.167.0` | `1.169.x`  | patch | sync to router version                                                  |
| `tailwindcss`                 | `^4.2.0`   | `4.3.0`    | minor | bump — Tailwind v4 line, no breaking syntax                             |
| `@tailwindcss/vite`           | `^4.2.0`   | `4.3.0`    | minor | sync to tailwindcss                                                     |
| `react` / `react-dom`         | `^19.2.4`  | `19.2.6`   | patch | bump — picked up via `^`                                                |
| `@types/react` / `-dom`       | `^19.2.x`  | `^19.2.x`  | -     | current                                                                 |
| `exceljs`                     | `^4.4.0`   | `4.4.0`    | —     | current                                                                 |

## Action items (low-risk batch)

These are picked up by a single `go get -u && go mod tidy` and `bun update`
without any code change:

```
# API
cd apps/api
go get \
  github.com/jackc/pgx/v5@latest \
  github.com/pressly/goose/v3@latest \
  github.com/go-chi/chi/v5@latest \
  github.com/caarlos0/env/v11@latest
go mod tidy

# FE
cd apps/web
bun update --latest \
  @biomejs/biome \
  @tanstack/react-query \
  @tanstack/react-router \
  @tanstack/router-cli \
  @tanstack/router-plugin \
  tailwindcss \
  @tailwindcss/vite
```

Dockerfile patches (separate commit):

- `apps/api/Dockerfile`: bump base image `golang:1.26.3-alpine`.
- `apps/web/Dockerfile`: bump base image `oven/bun:1.3.13`.
- `.github/workflows/*.yml`: align golangci-lint image to `v2.12.2`.

## Held back

- **TypeScript 6.0** — major bump; wait for TanStack Router / Query and
  Biome to publish a TS-6 compatibility statement. Revisit next round.
- **Vite 8** — major; needs `@vitejs/plugin-react-swc` + `@tailwindcss/vite`
  + `@tanstack/router-plugin` peer-dep verification first. Revisit next round.
- **Go `go.mod` directive bump to 1.26** — runtime already on 1.26 in dev;
  bumping the directive blocks anyone on 1.25, no functional gain right now.

## Verification

After applying the low-risk batch:

1. `make test-api` — full table-driven + integration suite.
2. `make types` — TS strict typecheck.
3. `make test-web` — alias of above.
4. `make hooks-run` — pre-commit sweep across the repo.
5. Manual smoke: dev stack up, login + refresh + one quotation lifecycle.
