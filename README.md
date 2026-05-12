# InternalGNS

Internal operations & finance tool for PT Global Niaga Sakti. Manages the
quotation → purchase order → invoice flow with Indonesian Coretax-compliant
tax document export.

## Stack

- **Frontend** — React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui,
  TanStack Router (file-based), TanStack Query, TanStack Table.
- **Backend** — Go 1.25 modular monolith: chi v5, pgx/v5, goose v3 (embedded),
  JWT (HS256), bcrypt, godotenv.
- **Database** — PostgreSQL 18-alpine with `pg_trgm`, GENERATED STORED columns,
  row-version triggers for optimistic locking, PL/pgSQL business functions.
- **Infra** — Docker Compose for dev, Dokploy on a single VPS for prod,
  Traefik for routing + Let's Encrypt, MinIO for file storage.

## Layout

```
apps/
  web/                React frontend (Vite, Bun)
  api/                Go backend
    cmd/api/          entrypoint
    internal/         feature modules + shared
    db/migrations/    goose schema history
    db/seeds/         master + dev sample data
    db/queries/       named SQL queries
infra/
  dokploy/            production docker-compose.yml + .env
docs/                 ERD, architecture, decisions
compose.dev.yml       dev stack
Makefile              single source of truth for all targets
```

## Run Locally — Step by Step

### 1. Prerequisites

Install once on machine:

| Tool | Version | Install |
|------|---------|---------|
| Go | 1.25+ | https://go.dev/dl/ or `brew install go` |
| Bun | 1.3+ | `curl -fsSL https://bun.sh/install \| bash` |
| Docker | latest | https://docs.docker.com/get-docker/ |
| Make | any | preinstalled on macOS/Linux. Windows: use WSL2 |
| psql | 14+ | `postgresql-client` package (Linux) or Postgres.app (macOS) |
| Git | any | preinstalled |

`make setup` auto-installs `goose` (via `go install`) if missing, so it's not
required up front. `psql` IS required because seeds run as raw SQL files.

Verify:

```bash
go version       # go1.25+
bun --version    # 1.3+
docker --version
make --version
psql --version
```

### 2. Clone

```bash
git clone https://github.com/<owner>/InternalGNS.git
cd InternalGNS
```

### 3. First-time setup

```bash
make setup
```

What it does:

- Checks `go`, `bun`, `docker` present.
- Copies `apps/api/.env.example` → `apps/api/.env` (if missing).
- Copies `apps/web/.env.example` → `apps/web/.env` (if missing).
- Installs `goose` CLI via `go install` (if missing).
- Runs `go mod tidy` in `apps/api`.
- Runs `bun install` in `apps/web`.

### 4. Start postgres + apply migrations + seed dev data

```bash
make seed-dev
```

What it does (single command, in order):

1. Starts postgres container (`compose.dev.yml`).
2. Runs all migrations via `go run ./cmd/api -bootstrap`
   (embedded goose; no separate goose call needed).
3. Creates superadmin user (id=1) from `SUPERADMIN_*` env vars.
4. Loads master data from `db/seeds/01_master.sql`:
   - 40 units (Coretax DJP UM.0001-UM.0033 + ship-supply extras).
   - 251 countries (ISO 3166 + ITU-T E.164 dial codes).
5. Loads dev samples from `db/seeds/02_dev_samples.sql`:
   - 2 sample users (`ops@`, `finance@`).
   - 3 clients (PT IMC, PT Yuxin, PT Transcoal) + 1 contact.
   - 3 vendors + 14 items + 13 vendor_products.
   - 1 quotation (Q-264128) with 13 line items.
   - 1 purchase order + 1 invoice + 4 invoice items.
   - Item-request-match learning entries.

Idempotent — re-run safe. Master uses `ON CONFLICT DO NOTHING`. Dev samples
use `TRUNCATE … RESTART IDENTITY CASCADE` to reset sample tables (preserves
superadmin user).

If you only need master tables (units + countries) without dev samples,
run `make seed` instead.

### 5. Start dev servers

```bash
make dev
```

Runs API + web in parallel:

- API → http://localhost:8080
- Web → http://localhost:5174

Web proxies `/api/*` → API at 8080 (configured in `vite.config.ts`).

`Ctrl+C` kills both.

### 6. Login

| Field | Value |
|-------|-------|
| URL | http://localhost:5174 |
| Email | `admin@globalsakti.com` |
| Password | `AdminGNS123!` |

Sample roles for testing:

- `ops@globalsakti.com` / `changeme` (operational)
- `finance@globalsakti.com` / `changeme` (finance)

## Daily Workflow

```bash
git pull
make seed-dev     # only if migrations or seeds changed
make dev          # work
# Ctrl+C when done
```

## Common Commands

| Command | Purpose |
|---------|---------|
| `make help` | List all targets |
| `make setup` | Prep env, deps, tools |
| `make db-up` | Start postgres only |
| `make db-down` | Stop postgres |
| `make db-logs` | Tail postgres logs |
| `make db-shell` | Open psql shell inside container |
| `make migrate` | Apply migrations + create superadmin (embedded goose) |
| `make migrate-up` | Raw goose up (alternative) |
| `make migrate-status` | Show migration state |
| `make migrate-down` | Roll back last migration |
| `make migrate-new NAME=xxx` | Create new migration file |
| `make seed` | Load master only (units + countries, idempotent) |
| `make seed-dev` | Migrate + master + dev sample data (recommended for dev) |
| `make schema-dump` | Dump current schema to `docs/schema_current.sql` |
| `make api` | Run API only |
| `make web` | Run Vite dev server only |
| `make dev` | Run API + web together |
| `make stack-up` | Build + start postgres + api containers |
| `make stack-down` | Stop full dev stack |
| `make stack-logs` | Tail dev stack logs |
| `make ps` | List dev containers |
| `make reset` | Wipe dev stack + volumes (nuclear) |
| `make build` | Build api binary + web bundle |
| `make test` | Run all tests (api + web typecheck) |
| `make test-api` | Go tests serialized (`-p=1` for godog stability) |
| `make test-web` | TypeScript typecheck |
| `make lint` | Lint api (go vet + golangci-lint) + web (biome) |
| `make fmt` | Format api (gofmt) + web (biome) |
| `make hooks-install` | Install pre-commit hooks (one-time) |
| `make hooks-run` | Run all pre-commit hooks across the repo |
| `make sqlc` | Regenerate sqlc code |
| `make tidy` | `go mod tidy` |
| `make docker-build` | Build api + web container images |
| `make clean` | Remove build artifacts |

## Troubleshooting

**Postgres won't start / mount errors:**
```bash
make reset && make seed-dev
```

**Port 5432 / 8080 / 5174 in use:**
```bash
lsof -i :5432    # find PID, kill it
```

**Migration error after pull:**
```bash
make reset && make seed-dev   # full rebuild
```

**Bun install hangs on Windows:**
Use WSL2. Native Windows not supported.

**`.env` missing:**
```bash
make setup        # idempotent, recreates from .env.example
```

**`psql: command not found`:**
- Linux: `sudo apt install postgresql-client`
- macOS: `brew install libpq && brew link --force libpq`
- Windows (WSL2): `sudo apt install postgresql-client`

**`goose: command not found`:**
```bash
go install github.com/pressly/goose/v3/cmd/goose@latest
# Ensure $(go env GOPATH)/bin is on PATH
```

**Stale frontend build:**
```bash
make clean && make web
```

**Tests flake / "Quotation 1 not found":**
Already handled — `make test-api` uses `-p=1` to serialize package execution
so godog ATDD scenarios don't race with integration TRUNCATE.

## Documents

- `docs/ERD.drawio.xml` — data model.
- `apps/api/db/migrations/` — schema history (goose).
- `apps/api/db/seeds/01_master.sql` — master (units, countries; idempotent).
- `apps/api/db/seeds/02_dev_samples.sql` — dev sample data.
- `apps/api/db/checks/` — ad-hoc verification SQL.
- `apps/api/db/queries/` — named SQL queries (loaded into `queries.Store`).

## Deploy

Production stack runs on Dokploy. See `infra/dokploy/` for the
`docker-compose.yml` and `.env.example`. CI publishes images to
`ghcr.io/<owner>/internalgns-api` and `ghcr.io/<owner>/internalgns-web`.
