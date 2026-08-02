# Deploy to VPS (shared with other Dokploy projects)

Step-by-step guide for deploying InternalGNS onto a single VPS that
**already** runs Dokploy + Traefik + Postgres + other projects (e.g.
`kerjacus-stack`, `dokploy/dokploy`, `traefik:v3.6.7`, `postgres:17-alpine`).

The stack runs in **co-tenancy mode**: own Postgres + MinIO inside a private
network, no host ports published, Traefik on the shared `dokploy-network`
routes ingress by hostname. Nothing in this stack collides with the existing
projects.

Source files referenced:
- `compose.prod.yml` — production compose
- `.env.prod.example` — env template
- `apps/api/Dockerfile`, `apps/web/Dockerfile` — image builds
- `.github/workflows/release.yml` — image publisher

## Compose files

| File | Purpose |
|---|---|
| `compose.dev.yml` | Local development. Builds `api` from source, exposes Postgres on `:5432`, pgweb on `:8081`, MinIO on `:9000/:9001`. CORS open. |
| `compose.prod.yml` | Production on the VPS via Dokploy. Pulls prebuilt images from GHCR, publishes no host ports, Traefik handles ingress. |

They stay separate because dev needs host-port access and a writable source
bind, while prod must not expose Postgres or MinIO outside Traefik. Neither is
named `docker-compose.yml`, so a bare `docker compose up` in the repo root
selects nothing and cannot start the production topology by accident. Always
pass `-f`.

## Coexistence on a shared VPS

The VPS hosts other Dokploy projects, so the compose is scoped to avoid
collisions:

- **Project name** `internalgns` (top-level `name:`) namespaces every container,
  the default network, and resource labels.
- **Volumes** are prefixed `internalgns_pgdata` and `internalgns_minio`, so
  `docker volume ls` never matches another project's names.
- **Traefik routers** use `internalgns-api` and `internalgns-web`. Router name
  collisions across projects are a common failure mode; keep these unique.
- **Hostnames** come from `${API_HOST}` and `${WEB_HOST}`. Traefik routes by
  `Host()`, not by port, so every project needs distinct DNS names.
- **No host ports** are published. Postgres and MinIO are reachable only on the
  internal network, so neither co-tenant projects nor the public internet can
  reach them.

## 0. Prerequisites

| What                  | Where / How                                                                  |
| --------------------- | ---------------------------------------------------------------------------- |
| VPS with Dokploy      | already running per `docker images` (`dokploy/dokploy`, `traefik:v3.6.7`)    |
| `dokploy-network`     | created by Dokploy on install; verify with `docker network ls`               |
| GitHub repo + GHCR    | repo pushed; GHCR auto-enabled via `release.yml` workflow                    |
| DNS records           | A records for `internalgns.yourdomain.id` + `api.internalgns.yourdomain.id`  |
| Secrets at hand       | strong DB password, JWT secret (32-byte hex), MinIO root password            |

Generate secrets locally before starting:

```bash
openssl rand -hex 32                 # JWT_SECRET
openssl rand -base64 24 | tr -d /=+  # DB_PASSWORD, MINIO_PASSWORD
```

## 1. Build + publish images (one-time per release)

The release workflow (`release.yml`) builds both images on every `v*.*.*`
tag push. Set the FE build-arg **before** tagging — Vite inlines it.

```bash
# 1a. In GitHub repo settings → Variables → Actions, set:
#     VITE_API_URL = https://api.internalgns.yourdomain.id/api/v1

# 1b. Tag and push from local clone of main
git checkout main
git pull
git tag v0.1.0
git push origin v0.1.0
```

The workflow publishes:
- `ghcr.io/<owner>/internalgns-api:v0.1.0` + `:latest` + `:sha-<short>`
- `ghcr.io/<owner>/internalgns-web:v0.1.0` + `:latest` + `:sha-<short>`

Verify in GitHub → Packages tab.

If the GHCR package visibility defaults to private, switch it to **public**
(repo → Packages → package settings → Change visibility) or create a Dokploy
registry credential with a GHCR PAT (`read:packages` scope).

## 2. Prepare the VPS (SSH, one-time)

```bash
ssh sysadmin@galung

# Confirm dokploy-network exists — Traefik uses it for ingress.
docker network ls | grep dokploy-network

# Confirm Traefik is on it and Let's Encrypt is configured.
docker inspect dokploy-traefik 2>/dev/null | grep -i certresolver
```

No other VPS prep needed. The compose creates its own private `internal`
network for Postgres + MinIO + API; only API + Web sit on `dokploy-network`
to be reachable by Traefik.

## 3. Create the Dokploy application

In the Dokploy web UI:

1. **Projects → New Project → InternalGNS** (or reuse an existing project).
2. **+ Create Service → Compose**.
3. **Source** = Git, repo URL = this repo, branch = `main`, compose path =
   `compose.prod.yml`.
4. **Save** (do not deploy yet — env is empty).

If you are updating an existing Dokploy app, change the compose path to
`compose.prod.yml` before the next deploy. The old
`infra/dokploy/docker-compose.yml` path no longer exists, and a deploy pointing
at it will fail.

## 4. Fill environment

Open the Compose app → **Environment** tab. Paste the body of
`.env.prod.example` and fill every placeholder:

```ini
GH_OWNER=<your-github-username-or-org>
TAG=v0.1.0

DB_NAME=gns_quotation
DB_USER=gns_app
DB_PASSWORD=<from openssl rand>

JWT_SECRET=<from openssl rand -hex 32>

CORS_ALLOWED_ORIGINS=https://internalgns.yourdomain.id

SUPERADMIN_EMAIL=admin@globalsakti.com
SUPERADMIN_NAME=Administrator
SUPERADMIN_PASSWORD=<choose a long passphrase, change after first login>

# Optional second superadmin (e.g. backup operator). Both fields required;
# leave EMAIL or PASSWORD empty to skip the second seed.
SUPERADMIN2_EMAIL=backup-admin@globalsakti.com
SUPERADMIN2_NAME=Backup Administrator
SUPERADMIN2_PASSWORD=<another long passphrase, also change after first login>

MINIO_USER=minioadmin
MINIO_PASSWORD=<from openssl rand>

CORETAX_SELLER_TIN=<16-digit NPWP, no separators>
CORETAX_SELLER_IDTKU=<NPWP + 6-digit branch, e.g. ...000000>

API_HOST=api.internalgns.yourdomain.id
WEB_HOST=internalgns.yourdomain.id

# Only referenced at image build time by CI — kept here for documentation.
VITE_API_URL=https://api.internalgns.yourdomain.id/api/v1
```

**Coexistence checks** (must hold to not collide with existing projects on
this VPS):

- `name: internalgns` in the compose isolates container / volume / default
  network names. No need to rename.
- `internalgns-api` and `internalgns-web` Traefik router names do not
  collide with `kerjacus-stack-*` or any other current project.
- `${API_HOST}` and `${WEB_HOST}` must be distinct DNS names from any other
  project hosted on this Traefik. The example FQDNs above are unique.

## 5. DNS

Point both `A` records at the VPS public IP:

```
internalgns.yourdomain.id        A    <vps-ip>
api.internalgns.yourdomain.id    A    <vps-ip>
```

Traefik issues Let's Encrypt certs on first request after DNS resolves.
Allow up to ~2 minutes after first 200 hit.

## 6. First deploy

In Dokploy UI on the Compose app:

1. Click **Deploy**.
2. Watch the deploy log. Order:
   - Pull `ghcr.io/.../internalgns-api:vX.Y.Z` + `internalgns-web:vX.Y.Z`.
   - Start `postgres` → wait for healthcheck (`pg_isready`).
   - Start `minio` → wait for healthcheck (`mc ready local`).
   - Start `api` — on boot the API runs embedded goose migrations against
     the Postgres in this stack. First boot also seeds the superadmin row
     from `SUPERADMIN_*`.
   - Start `web` (static nginx-served Vite bundle).
3. Browse `https://internalgns.yourdomain.id` — the login screen should load.
4. Log in with `SUPERADMIN_EMAIL` + `SUPERADMIN_PASSWORD`.
5. **Change the superadmin password immediately** (UI → profile menu).

## 7. Seed master data (optional)

Master data (units + countries) is loaded by the dev seed. For prod, run it
**once** against the prod DB from the VPS shell:

```bash
ssh sysadmin@galung
docker compose -p internalgns exec -T postgres \
  psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  < apps/api/db/seeds/01_master.sql
```

(Replace `$DB_USER` / `$DB_NAME` with the values from `.env`.) Do **not**
run `02_dev_*.sql` or later seeds on prod — those are dev fixtures.

## 8. MinIO bucket bootstrap

The API creates the buckets it needs on first write, but you can pre-create
them and set lifecycle rules ahead of time:

```bash
docker compose -p internalgns exec minio sh -c \
  'mc alias set local http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" && \
   mc mb -p local/internalgns-clients local/internalgns-vendors \
            local/internalgns-items local/internalgns-invoices \
            local/internalgns-purchase-orders local/internalgns-quotations'
```

## 9. Smoke checklist

| Check                                  | Expected                                          |
| -------------------------------------- | ------------------------------------------------- |
| `curl https://api…/api/v1/healthz`     | `200 OK`                                          |
| Login with superadmin                  | redirects to dashboard                            |
| Create a client                        | success, X-Total-Count increments                 |
| Upload a logo (presigned)              | object appears in MinIO `internalgns-clients`     |
| Create + export a quotation PDF        | PDF downloads, signer + bank fields present       |
| Create a PO with delivery note        | success, delivery_note_number sequenced           |
| Token refresh (idle ~25h)              | UI stays logged in (refresh-token rotation works) |

## 10. Operations

| Task             | How                                                                                |
| ---------------- | ---------------------------------------------------------------------------------- |
| Redeploy         | bump `TAG=` in env, then **Deploy** in Dokploy UI                                  |
| Rollback         | set `TAG=` back to previous version, **Deploy**                                    |
| Logs             | Dokploy UI → Logs tab (per-service)                                                |
| DB backup        | Dokploy → Databases → add Postgres connection → schedule S3 / local backups        |
| DB shell         | `docker compose -p internalgns exec postgres psql -U $DB_USER $DB_NAME`            |
| MinIO console    | not exposed; use `mc` from inside the container as above                           |
| Orphan blob sweep| `docker compose -p internalgns exec api /app/orphan-blobs --dry-run` (add `=false` to delete) |
| Restart service  | Dokploy UI → Restart, or `docker compose -p internalgns restart api`               |

## 11. Auto-redeploy on new tag (optional)

Dokploy supports image-watch webhooks. Configure on the Compose app:

1. **Auto Deploy → enable**.
2. Set **Source** trigger to GitHub release / tag push (Dokploy generates a
   webhook URL).
3. Add the URL to GitHub repo → Settings → Webhooks → Add webhook, content
   type `application/json`, event = `Releases`.

Every `git tag v… && git push origin v…` then triggers: CI builds → GHCR
publish → Dokploy pulls new tag → rolling restart.

## 12. Troubleshooting

| Symptom                                          | Likely cause / fix                                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Traefik returns 404 for the WEB / API host       | DNS not propagated, or hostname collides with an existing project — confirm `host()` is unique  |
| `api` container restarts in a loop               | check logs for migration failure — usually env mismatch (`DATABASE_URL` cannot reach postgres)  |
| Login returns 401 immediately after first deploy | superadmin row never created — check api logs for `bootstrap superadmin` line                   |
| LetsEncrypt rate-limit / cert pending            | wait 60s after first DNS-resolved request; or check `dokploy-traefik` logs for ACME challenge   |
| Web bundle hits wrong API URL                    | `VITE_API_URL` was not set in GitHub Actions Variables at image-build time — rebuild + retag    |
| Postgres OOM on dataset import                   | raise `max_connections` / shared_buffers via Dokploy → Postgres → server params                 |
| MinIO disk full                                  | run orphan blob sweep, then prune Postgres backups                                               |

## 13. Rollback drill

Rehearse once before relying on it:

```bash
# in Dokploy UI:
#   TAG = v0.0.9 (the previous release)
#   Deploy
```

Migrations are forward-only (goose) — rolling back the image rolls back code
only, not schema. If a migration is incompatible with the previous image
version, roll forward instead (fix-up release).
