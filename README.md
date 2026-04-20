# InternalGNS

Internal operations & finance tool for PT Global Niaga Sakti. Manages the
quotation → purchase order → invoice flow with Indonesian Coretax-compliant
tax document export.

## Stack

- **Frontend** — React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui,
  TanStack Router (file-based), TanStack Query, TanStack Table.
- **Backend** — Go 1.23 modular monolith: chi, pgx/v5, sqlc, goose, JWT,
  tectonic (LaTeX → PDF), excelize (Coretax Excel).
- **Database** — PostgreSQL 17 with `pg_trgm`, GENERATED STORED columns, and
  row-version triggers for optimistic locking.
- **Infra** — Docker, Dokploy on a single VPS, Traefik for routing, MinIO for
  file storage.

## Layout

```
apps/
  web/          React frontend
  api/          Go backend (cmd/, internal/, migrations/, templates/)
infra/
  dokploy/      docker-compose.yml + env for production deploy
docs/
  ERD.drawio.xml, architecture.md, decisions/
```

## Quick start

```bash
cp apps/api/.env.example apps/api/.env
cp infra/dokploy/.env.example infra/dokploy/.env

make db-up        # start Postgres + MinIO
make migrate      # apply schema (goose)
make seed         # load master + dev sample data
make dev          # run api + web
```

API on `:8080`, web on `:5174`.

## Documents

- `docs/ERD.drawio.xml` — data model.
- `apps/api/migrations/` — schema history (goose).
- `apps/api/migrations/seeds/` — master + dev sample data.
- `apps/api/migrations/checks/` — ad-hoc verification SQL.

## Deploy

See `infra/dokploy/README.md`.
