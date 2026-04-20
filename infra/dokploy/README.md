# Dokploy deployment

This stack runs on a single VPS managed by Dokploy. Four services share the
internal network; `api` and `web` are exposed through Dokploy's external
Traefik via labels.

## First-time setup

1. In Dokploy, create a **Compose** application pointing at this repo, path
   `infra/dokploy/docker-compose.yml`.
2. Set environment variables — copy `.env.example`, fill in secrets. The
   `dokploy-network` referenced here is the external Traefik network Dokploy
   creates automatically on install; do not create it manually.
3. First deploy: Dokploy pulls images from GHCR and starts Postgres + MinIO
   first (healthchecks gate `api`), then `api` runs its embedded goose
   migrations against Postgres on boot.
4. Point your DNS `A` records for `${API_HOST}` and `${WEB_HOST}` at the VPS
   IP. Let's Encrypt certificates are issued automatically by Dokploy's
   Traefik on first request.

## Operations

| Task | Where |
|---|---|
| View logs | Dokploy UI → application → Logs tab |
| Run migrations | Automatic on container start (embedded via goose) |
| Apply dev seeds | `make -C apps/api seed-dev` against the VPS DB — do **not** run on prod |
| Database backup | Dokploy → Databases → Postgres → Backups (S3/local) |
| MinIO console | `https://${WEB_HOST}:9001` (restrict via Traefik middleware) |

## Image builds

CI builds and pushes to GHCR on every merge to `main`:

- `ghcr.io/${GH_OWNER}/internalgns-api:${TAG}`
- `ghcr.io/${GH_OWNER}/internalgns-web:${TAG}`

Dokploy can be configured to auto-redeploy on new image tags (webhook or
polling).
