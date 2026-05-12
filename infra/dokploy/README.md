# Dokploy deployment

Production stack for a single VPS managed by Dokploy. Four services share an
internal-only Docker network; only `api` and `web` are exposed through
Dokploy's external Traefik via labels.

## Compose files at a glance

| File | Purpose |
|---|---|
| `compose.dev.yml` (repo root) | Local development. Builds `api` from source, exposes Postgres on `:5432`, pgweb on `:8081`, MinIO on `:9000/:9001`. CORS open. |
| `infra/dokploy/docker-compose.yml` | Production on VPS via Dokploy. Pulls prebuilt images from GHCR, no host ports, Traefik handles ingress. |

The two are deliberately separate: dev needs host-port access and a writable
source bind, prod must not expose Postgres or MinIO outside Traefik.

## Coexistence on a shared VPS

This VPS hosts two other Dokploy projects alongside this one. The compose is
scoped so nothing collides:

- **Project name** `internalgns` (top-level `name:` field) namespaces every
  container, default network, and resource label.
- **Volumes** are prefixed: `internalgns_pgdata`, `internalgns_minio`. Listing
  `docker volume ls` will not match other projects' volume names.
- **Traefik routers** use unique names: `internalgns-api`, `internalgns-web`.
  Router collisions across projects are a common failure mode; pick names that
  cannot clash.
- **Hostnames** are driven by `${API_HOST}` and `${WEB_HOST}` — every project
  should own distinct DNS names. Traefik routes by `Host()`, not by port.
- **No host ports** are published. Postgres and MinIO are reachable only on the
  internal network. Co-tenant projects cannot reach them; neither can the
  public internet.

## First-time setup

1. In Dokploy, create a **Compose** application pointing at this repo, path
   `infra/dokploy/docker-compose.yml`.
2. Copy `infra/dokploy/.env.example` to the Dokploy app's environment and fill
   in secrets. The `dokploy-network` referenced in the compose is the external
   Traefik network Dokploy creates on install; do not create it manually.
3. First deploy: Dokploy pulls images from GHCR. Postgres and MinIO come up
   first (healthchecks gate `api`); `api` then runs its embedded goose
   migrations against Postgres on boot.
4. Point DNS `A` records for `${API_HOST}` and `${WEB_HOST}` at the VPS IP.
   Let's Encrypt certificates are issued automatically by Dokploy's Traefik on
   first request.

## Operations

| Task | Where |
|---|---|
| View logs | Dokploy UI → application → Logs tab |
| Run migrations | Automatic on `api` container start (embedded goose) |
| Apply dev seeds | `make -C apps/api seed-dev` against the VPS DB — never on prod |
| Database backup | Dokploy → Databases → Postgres → Backups (S3/local) |
| MinIO console | Not exposed publicly (no host port, no Traefik label). Manage from inside the container: `docker compose -p internalgns exec minio mc alias set local http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" && docker compose -p internalgns exec minio mc ls local`. For a web UI, add Traefik labels for port 9001 behind a basic-auth middleware. |
| Restart a service | Dokploy UI → application → Actions → Restart |

## Image builds

CI builds and pushes to GHCR on every merge to `main`:

- `ghcr.io/${GH_OWNER}/internalgns-api:${TAG}`
- `ghcr.io/${GH_OWNER}/internalgns-web:${TAG}`

The web image bakes `VITE_API_URL` at build time (Vite inlines `import.meta.env`
into the bundle). CI must pass `--build-arg VITE_API_URL=...` matching the
target environment; the same image cannot be reused across environments with
different API hosts.

Dokploy can be configured to auto-redeploy on new image tags via webhook or
polling.

## Test data and fixtures

Quotation upload fixtures live at `apps/api/testdata/import_quotation/`
(`quotation_upload_automate_1.xlsx`, `_2.xlsx`, `_3.xlsx`). These are
development-only and never shipped in production images — the API Dockerfile
copies the compiled binary, not the `testdata/` tree.
