# Deploy to VPS (shared with other Dokploy projects)

Step-by-step guide for deploying InternalGNS onto a single VPS that
**already** runs Dokploy + Traefik + Postgres + other projects (e.g.
`kerjacus-stack`, `dokploy/dokploy`, `traefik:v3.6.7`, `postgres:17-alpine`).

The stack runs in **co-tenancy mode**: own Postgres + MinIO inside a private
network, no host ports published, Traefik on the shared `dokploy-network`
routes ingress by hostname. Nothing in this stack collides with the existing
projects.

Source files referenced:
- `compose.prod.yml`: production compose
- `.env.prod.example`: env template
- `apps/api/Dockerfile`, `apps/web/Dockerfile`: image builds
- `.github/workflows/release.yml`: image publisher
- `scripts/backup.sh`, `scripts/restore.sh`: backups (`docs/backup_restore.md`)

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

The production services are `gns-postgres`, `gns-minio`, `api` and
`frontend`. Use these names in every command below; `postgres` and `minio`
are the dev services.

## Coexistence on a shared VPS

The VPS hosts other Dokploy projects, so the compose is scoped to avoid
collisions:

- **Project name** `internalgns` (top-level `name:`) namespaces every container,
  the default network, and resource labels. Dokploy may start the stack under
  its own project name instead; see "Find the project name" below.
- **Volumes** are prefixed `internalgns_pgdata` and `internalgns_minio`, so
  `docker volume ls` never matches another project's names.
- **Traefik routers** use `internalgns-api` and `internalgns-web`, and the
  middlewares `internalgns-api-headers` and `internalgns-web-headers`. Router
  and middleware name collisions across projects are a common failure mode;
  keep these unique.
- **Hostnames** come from `${API_HOST}` and `${WEB_HOST}`. Traefik routes by
  `Host()`, not by port, so every project needs distinct DNS names.
- **No host ports** are published. Postgres and MinIO are reachable only on the
  internal network, so neither co-tenant projects nor the public internet can
  reach them.

### Find the project name

Every command that names a container needs the real compose project. Read it
from the labels once the stack runs:

```bash
P=$(docker ps --filter label=com.docker.compose.service=gns-postgres \
  --format '{{.Label "com.docker.compose.project"}}')
echo "$P"   # containers are "$P-gns-postgres-1", "$P-api-1", ...
```

## 0. Prerequisites

| What                  | Where / How                                                                  |
| --------------------- | ---------------------------------------------------------------------------- |
| VPS with Dokploy      | already running per `docker images` (`dokploy/dokploy`, `traefik:v3.6.7`)    |
| `dokploy-network`     | created by Dokploy on install; verify with `docker network ls`               |
| GitHub repo + GHCR    | repo pushed; GHCR auto-enabled via `release.yml` workflow                    |
| DNS records           | A records for `internalgns.yourdomain.id` + `api.internalgns.yourdomain.id`  |
| Secrets at hand       | strong DB password, JWT secret (32-byte hex), MinIO root user and password   |

Generate secrets locally before starting:

```bash
openssl rand -hex 32                 # JWT_SECRET
openssl rand -base64 24 | tr -d /=+  # DB_PASSWORD, MINIO_PASSWORD
openssl rand -hex 6                  # suffix for MINIO_USER, e.g. gns-<hex>
```

## 1. Build + publish images (one-time per release)

The release workflow (`release.yml`) builds both images after CI passes on a
`v*.*.*` tag push. Set the FE build-arg **before** tagging, because Vite
inlines it.

```bash
# 1a. In GitHub repo settings → Variables → Actions, set:
#     VITE_API_URL = https://api.internalgns.yourdomain.id/api/v1

# 1b. Tag and push from local clone of main
git checkout main
git pull
git tag v0.4.0
git push origin v0.4.0
```

The workflow publishes exactly two tags per image:
- `ghcr.io/<owner>/internalgns-api:v0.4.0` + `:sha-<short>`
- `ghcr.io/<owner>/internalgns-web:v0.4.0` + `:sha-<short>`

There is no `:latest`. `compose.prod.yml` refuses to start while `TAG` is
empty, so a deploy always names the release it runs.

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

The compose creates its own private `internal` network for Postgres, MinIO
and the API; only the API and the web container sit on `dokploy-network`, so
Traefik can reach them.

Install the nightly backup before the first real data goes in. The steps are in
`docs/backup_restore.md`.

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
`.env.prod.example` and fill every value. The api validates its configuration
at start and exits with `load config` in its log when a value is missing or
still a template. It refuses:

- a `JWT_SECRET` shorter than 32 bytes, the template value, or the dev value;
- a missing, template or dev `SUPERADMIN_PASSWORD`;
- `CORS_ALLOWED_ORIGINS=*`;
- `minioadmin` or any `CHANGE_ME` as the MinIO user or password;
- an empty or `-` `PDF_BANK_ACCOUNT_NO`, or a template `PDF_SIGNER_NAME`.

A filled-in block that passes those checks looks like this:

```ini
GH_OWNER=<your-github-username-or-org>
TAG=v0.4.0

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

# Not minioadmin: production refuses the vendor default.
MINIO_USER=gns-<openssl rand -hex 6>
MINIO_PASSWORD=<from openssl rand>

# Web app origin for the MinIO CORS allowance, no trailing slash.
WEB_ORIGIN=https://internalgns.yourdomain.id

CORETAX_SELLER_TIN=<16-digit NPWP, no separators>
CORETAX_SELLER_IDTKU=<NPWP + 6-digit branch, e.g. ...000000>

API_HOST=api.internalgns.yourdomain.id
WEB_HOST=internalgns.yourdomain.id

# Only referenced at image build time by CI — kept here for documentation.
VITE_API_URL=https://api.internalgns.yourdomain.id/api/v1

# Leave empty to size the xelatex pool from the container CPU limit.
PDF_RENDER_CONCURRENCY=

# Printed on every quotation and invoice sent to clients.
PDF_SIGNER_NAME=<name of the signing director>
PDF_BANK_NAME=BCA
PDF_BANK_ACCOUNT_NO=<the account clients transfer into>
PDF_BANK_ACCOUNT_NM=PT GLOBAL NIAGA SAKTI
PDF_PAYMENT_TERMS=Pembayaran 30 hari
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
   - Start `gns-postgres` → wait for healthcheck (`pg_isready`).
   - Start `gns-minio` → wait for healthcheck (`mc ready local`).
   - Start `api`. On boot the API runs the embedded goose migrations against
     the Postgres in this stack, creates the five MinIO buckets it uses, and
     on first boot seeds the superadmin row from `SUPERADMIN_*`.
   - Start `frontend` (static nginx-served Vite bundle).
3. Browse `https://internalgns.yourdomain.id` — the login screen should load.
4. Log in with `SUPERADMIN_EMAIL` + `SUPERADMIN_PASSWORD`.
5. **Change the superadmin password immediately** (UI → profile menu).

## 7. Seed master data (optional)

Master data (units + countries) is loaded by the dev seed. For prod, run it
**once** against the prod DB. The seed file lives in the repository, not on the
VPS, so pipe it from a local clone over SSH:

```bash
# from the repository root on your machine
ssh sysadmin@galung 'docker exec -i \
  $(docker ps -q --filter label=com.docker.compose.service=gns-postgres) \
  sh -c "PGCLIENTENCODING=UTF8 psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -v ON_ERROR_STOP=1"' \
  < apps/api/db/seeds/01_master.sql
```

The container supplies its own user and database name. Do **not** run
`02_dev_*.sql` or later seeds on prod — those are dev fixtures.

## 8. MinIO buckets

The API creates `po-docs`, `client-logos`, `vendor-logos`, `item-images` and
`invoice-attachments` on every boot when they are missing. Nothing needs
creating by hand. To confirm:

```bash
docker exec "$P-gns-minio-1" sh -c \
  'mc alias set local http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && mc ls local'
```

## 9. Smoke checklist

| Check                                          | Expected                                                   |
| ---------------------------------------------- | ---------------------------------------------------------- |
| `curl https://api…/healthz`                    | `200 ok` (process up)                                      |
| `curl https://api…/readyz`                     | `200` (database reachable)                                 |
| `curl -sI https://api…/healthz`                | `strict-transport-security: max-age=31536000`              |
| `curl -sI https://internalgns…/login`          | `strict-transport-security` and `content-security-policy-report-only` |
| Login with superadmin                          | redirects to dashboard                                     |
| Create a client                                | success, X-Total-Count increments                          |
| Upload a logo                                  | object appears in MinIO `client-logos`                     |
| Create + export a quotation PDF                | PDF downloads, signer + bank fields present                |
| Create a PO with delivery note                 | success, delivery_note_number sequenced                    |
| Token refresh (idle ~25h)                      | UI stays logged in (refresh-token rotation works)          |

`/healthz` and `/readyz` sit at the API host root, not under `/api/v1`.

## 10. Operations

| Task             | How                                                                                |
| ---------------- | ---------------------------------------------------------------------------------- |
| Redeploy         | bump `TAG=` in env, then **Deploy** in Dokploy UI                                  |
| Rollback         | set `TAG=` back to previous version, **Deploy** (read section 14 first)            |
| Logs             | Dokploy UI → Logs tab (per-service)                                                |
| Backup, restore  | `docs/backup_restore.md`: nightly host timer, restore rehearsal, disaster restore  |
| DB shell         | `docker exec -it "$P-gns-postgres-1" sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'` |
| MinIO console    | not exposed; use `mc` inside `$P-gns-minio-1` as in section 8                      |
| Orphan blob sweep| `docker exec "$P-api-1" /app/orphan-blobs --dry-run`; never purge against a restored older database |
| Restart service  | Dokploy UI → Restart, or `docker restart "$P-api-1"`                               |

The `cleanup` GitHub workflow cannot reach this MinIO: it runs on a GitHub
runner, and MinIO has no public route. Run the sweeper on the VPS as above.

## 11. Monitoring and alerts

Every container has a healthcheck (`pg_isready`, `mc ready local`,
`/app/api --healthcheck` probing `/readyz`, and nginx `/healthz`). Plain
compose only marks a failing container `unhealthy`. It neither restarts it
nor tells anyone, so something outside the VPS has to watch.

1. **External uptime check.** A free monitor on a service off this VPS (for
   example UptimeRobot's free plan, or Uptime Kuma on another machine):
   - `https://<API_HOST>/readyz`, every 1-5 minutes. It answers 200 only when
     the API can reach Postgres, so it covers the API, the database and
     Traefik's route.
   - `https://<WEB_HOST>/healthz` at the same interval.
   - Alert after two consecutive failures, by email or chat.

   `/readyz` does not check MinIO. A MinIO outage shows up as failed uploads and
   downloads, and as `unhealthy` in `docker ps`.
2. **Backups and disk.** The backup job's dead-man switch (`BACKUP_PING_URL`,
   `docs/backup_restore.md`) alerts when a nightly run fails or does not run.
   The same run refuses to start, and alerts, once the disk is 85% full.
3. **By hand after any incident:**
   `docker ps --filter health=unhealthy --filter label=com.docker.compose.project="$P"`.

## 12. Security headers

Traefik adds these at the edge, because it is the only layer that terminates
TLS. They are set in the `compose.prod.yml` labels:

- `Strict-Transport-Security: max-age=31536000` on both hosts. There is no
  `includeSubDomains` or `preload` until every sibling host is known to be
  HTTPS-only.
- `Content-Security-Policy-Report-Only` on the web host. It allows exactly what
  the SPA loads: its own scripts, styles and fonts, `blob:` and `data:` images
  (logos and upload previews), and `https://<API_HOST>` for API calls. The API
  already sends its own `default-src 'none'` policy on its responses.

On 2026-09-25 this policy was checked through a local Traefik v3.6.7 in front of
the production images. Every screen, a logo upload, an RFQ `.xlsx` import (which
loads exceljs) and a PDF opened in a `blob:` tab produced no report. A planted
inline script, inline style and remote image did produce reports, so the check
was live.

There is no report endpoint, so violations only appear in the browser console
as `[Report Only] Refused to ...`. To enforce the policy:

1. After a release ships, have a superadmin, a finance user and an operational
   user each go through their daily screens with DevTools open, including a
   PDF export, an upload and an RFQ import.
2. If two weeks pass with no `[Report Only]` line, rename the label key from
   `Content-Security-Policy-Report-Only` to `Content-Security-Policy` and
   redeploy.
3. If a line appears, fix the cause or widen the one directive it names. Never
   add `'unsafe-inline'` or `'unsafe-eval'` to `script-src`.

## 13. Pre-deploy checks

Run these before every deploy that carries migrations, and before the first
deploy of this branch. Its first deploy moves the database from the last
migration in v0.3.1 (00047) to the last one in the new release.

### Migration order

- 00058 and 00060 are retired. They never existed on `main` and must not be
  created later. Goose skips the gaps.
- 00063 and 00064 must be applied together. 00064 was committed before 00063,
  so an image built from that commit (`c18fd56`) records 00064 without 00063.
  Goose then treats 00063 as a missing out-of-order migration and the next
  image cannot migrate. Deploy only release tags, and never an image built
  between those two commits.

Read-only checks against production (`$P-gns-postgres-1`, psql as above):

```sql
BEGIN READ ONLY;
-- Expected: zero rows. A row means a retired migration ran from an
-- unmerged build; stop and restore from the last good backup.
SELECT version_id FROM goose_db_version WHERE version_id IN (58, 60);
-- Expected: the last migration in the deployed tag (00047 for v0.3.1);
-- after the deploy, the last one in the new release.
SELECT max(version_id) FROM goose_db_version WHERE is_applied;
-- Expected: zero rows. 00064 without 00063 is the broken state above.
SELECT 64 WHERE EXISTS (SELECT 1 FROM goose_db_version WHERE version_id = 64)
  AND NOT EXISTS (SELECT 1 FROM goose_db_version WHERE version_id = 63);
ROLLBACK;
```

### Revision quotations with no child

Before migration 00059 a quotation could be moved to `revision` as a plain
status change, with no clone behind it. Since 00059 the only way into
`revision` is `fn_revise_quotation`, which creates the next version (a child
with `parent_id` pointing at the original) in the same transaction. A legacy
`revision` row with no child is a dead end: it cannot be edited (only drafts
can, and the refusal is now a 409), cannot be revised again (only `sent` can),
and has no draft to continue from. The status machine
(`quotations.Transitions`, mirrored in `fn_change_quotation_status`) lets
`revision` go only to `rejected` or `cancelled`, both with a reason.

```sql
BEGIN READ ONLY;
SELECT q.id, q.quotation_no, q.version, q.company_client_name, q.updated_at
FROM quotations q
WHERE q.status = 'revision'
  AND NOT EXISTS (SELECT 1 FROM quotations c WHERE c.parent_id = q.id)
ORDER BY q.updated_at;
ROLLBACK;
```

- Expected: zero rows.
- Dev database `gns_quotation` on 2026-09-24: zero rows.
- If rows come back, do not script a fix. Someone in operations has to decide
  what happens to each quotation:
  - Closed: reject or cancel it with a reason in the UI. This is a normal
    transition and is recorded in `quotation_status_history`.
  - Still being negotiated: the app has no way back to `sent`, so issue a new
    quotation. If the number chain must continue instead, a DBA can reset the
    row and revise it in one transaction, so the expiry job never sees it as
    `sent`. `fn_expire_quotations` dates the window from the last
    `to_status = 'sent'` history row, so a legacy row left in `sent` would
    expire on the next tick:

    ```sql
    BEGIN;
    UPDATE quotations SET status = 'sent' WHERE id = $1 AND status = 'revision';
    SELECT fn_revise_quotation($1, $2, 'Revisi lanjutan dari data lama');
    COMMIT;
    ```

    `$1` is the quotation id, and `$2` is the acting user's id. The reset goes
    around the status machine and writes no history row of its own, so
    record the reason outside the database as well.

### Migration dry run on a restored copy

Migrations only go forward, so rehearse them on last night's backup before
production runs them. This restores the newest snapshot into a throwaway
database and bucket, then runs the new image's `-bootstrap` (migrate, seed the
superadmin, exit) against it. Production data is only read.

```bash
set -a; . /etc/internalgns-backup.env; set +a
NEW_IMAGE=ghcr.io/<owner>/internalgns-api:<new TAG>
SNAP=$(ls -d /var/backups/internalgns/daily/*/ | tail -1)
/opt/internalgns-ops/restore.sh "$SNAP" gns_predeploy predeploy-check

PG=$(docker ps -q --filter label=com.docker.compose.project=$COMPOSE_PROJECT \
  --filter label=com.docker.compose.service=gns-postgres)
PGUSER=$(docker exec "$PG" printenv POSTGRES_USER) \
PGPASSWORD=$(docker exec "$PG" printenv POSTGRES_PASSWORD) \
sh -c 'docker run --rm --network "container:$0" --read-only --tmpfs /tmp -e HOME=/tmp \
  -e DATABASE_URL="postgres://$PGUSER:$PGPASSWORD@127.0.0.1:5432/gns_predeploy?sslmode=disable" \
  -e JWT_SECRET="$(openssl rand -hex 32)" -e SUPERADMIN_PASSWORD="$(openssl rand -hex 16)" \
  -e MINIO_ACCESS_KEY= -e MINIO_SECRET_KEY= "$1" -bootstrap' "$PG" "$NEW_IMAGE"
# Expected: "bootstrap done" and exit 0. Then the read-only checks above,
# against gns_predeploy, should show the new max version.
```

Clean up afterwards with the `dropdb` and `mc rb --force` commands from the
rehearsal section of `docs/backup_restore.md`, using `gns_predeploy` and
`predeploy-check`. A failed dry run means production would fail the same way
on boot. Fix the release, not the database.

### Just before Deploy

1. Start a backup now, not last night's:
   `systemctl start internalgns-backup.service`, and confirm `backup ok` in
   `journalctl`.
2. Note the current `TAG`, which is the rollback target.

## 14. Rollback drill

Rehearse once before relying on it:

```bash
# in Dokploy UI:
#   TAG = v0.3.1 (the previous release)
#   Deploy
```

Migrations are forward-only (goose), so rolling back the image rolls back
code only, not schema. If a migration is incompatible with the previous image
version, roll forward instead with a fix-up release, or restore the pre-deploy
backup (`docs/backup_restore.md`, disaster restore) and deploy the previous
`TAG` on it.

## 15. Auto-redeploy (optional)

Dokploy can redeploy the Compose app from a GitHub webhook. The images are
pinned by `TAG` in the environment, so a webhook redeploy only applies changes
to `compose.prod.yml`. It does not move to a new release. Moving to a release
is always: bump `TAG`, then **Deploy**.

Deploys recreate the api container; there is no rolling restart. Expect a
short outage while the old container drains (up to 80 s) and the new one
passes its healthcheck.

## 16. Troubleshooting

| Symptom                                          | Likely cause / fix                                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Deploy fails: `required variable TAG is missing` | `TAG` is empty. Set it to a published `vX.Y.Z`; `latest` does not exist                          |
| Traefik returns 404 for the WEB / API host       | DNS not propagated, the hostname collides with an existing project, or a router or middleware label is wrong: `docker logs dokploy-traefik` names it |
| `api` exits with `load config` in its log        | a value from section 4 is missing, still a template, or `minioadmin`; the log line names it     |
| `api` container restarts in a loop               | check logs for migration failure — usually env mismatch (`DATABASE_URL` cannot reach postgres)  |
| Login returns 401 immediately after first deploy | superadmin row never created — check api logs for `bootstrap superadmin` line                   |
| LetsEncrypt rate-limit / cert pending            | wait 60s after first DNS-resolved request; or check `dokploy-traefik` logs for ACME challenge   |
| Web bundle hits wrong API URL                    | `VITE_API_URL` was not set in GitHub Actions Variables at image-build time — rebuild + retag    |
| Postgres out of memory on a large import         | raise the `gns-postgres` memory limit or tune `-c` settings in `compose.prod.yml`, then redeploy |
| Disk full                                        | check `du -sh /var/backups/internalgns` and Docker's data root; run the orphan sweep dry run first |
