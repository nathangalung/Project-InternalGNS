# Backup and restore

Production keeps everything on one VPS disk: filed invoices, the ledger and
every uploaded document. This page covers how that data is copied every night,
how a copy is restored, and how to prove a restore works. The scripts are
`scripts/backup.sh`, `scripts/restore.sh` and `scripts/backup-lib.sh`.

## What a backup contains

`scripts/backup.sh` runs on the Docker host, outside the stack. The stack's
network is internal-only, so a sidecar container would have no way out.

1. `pg_dump -Fc` of the application database, run in the `gns-postgres`
   container. `pg_restore -l` then reads the dump back, and the run fails if the
   table of contents comes back empty.
2. Exact row counts for every table. They run in the same repeatable-read
   snapshot that `pg_dump --snapshot` reads, so they describe the dump
   exactly even while the api keeps writing.
3. Every object in every MinIO bucket, copied as plain files by `mcli mirror`.
   The copy runs in a throwaway container that shares the `gns-minio` network
   namespace and uses the image already on the host: the Silo server image
   ships `mcli`, and on the old `minio/minio` image the scripts fall back to
   its `mc`, so they work before the Silo deploy and after a rollback (see
   "Object storage image" in `docs/deploy_vps.md`). If the copy holds fewer
   objects than MinIO held when it started, the run fails.
4. Object count and bytes per bucket, and a `SHA256SUMS` over every file.

The database is dumped before the objects are copied. That way every object key
in the dump points at an object that was already uploaded when the copy ran.

Layout under `BACKUP_ROOT` (default `/var/backups/internalgns`, mode 700):

```
daily/<YYYY-MM-DDTHHMMSS>/   the last 7 runs (KEEP_DAILY)
weekly/<...>/                Sunday runs, hard-linked, the last 4 (KEEP_WEEKLY)
.lock                        flock against overlapping runs
```

A run writes into `<stamp>.partial` and renames the directory only when every
step has passed, so a half-written snapshot never counts as a backup. Files are
never changed after that rename, so the weekly hard links stay independent.

The database and the uploads are small. The 2026-09-25 rehearsal data (24,806
rows, 73 objects) produced a 1.8 MB snapshot. Check `du -sh $BACKUP_ROOT` after
the first week and size the retention from that.

The run refuses to start when the backup filesystem or Docker's data root is at
or above `DISK_MAX_PCT` (default 85). Writing a dump onto a nearly full disk
could starve Postgres of space for its own WAL.

## Install on the VPS

Do this once as root. Copy the scripts from the release you deploy. The
Dokploy checkout is replaced on every deploy, so do not run them from there.

```bash
TAG=v0.4.0   # the release you deploy
git clone --depth 1 --branch "$TAG" https://github.com/<owner>/<repo>.git /tmp/gns
install -d -m 755 /opt/internalgns-ops
install -m 755 /tmp/gns/scripts/backup.sh /tmp/gns/scripts/restore.sh /opt/internalgns-ops/
install -m 644 /tmp/gns/scripts/backup-lib.sh /opt/internalgns-ops/
rm -rf /tmp/gns
install -d -m 700 /var/backups/internalgns
```

Dokploy may run the stack under its own project name instead of the compose
`name:`. Read the real one from the container labels:

```bash
docker ps --filter label=com.docker.compose.service=gns-postgres \
  --format '{{.Label "com.docker.compose.project"}}'
```

Put it in `/etc/internalgns-backup.env` (mode 600):

```ini
COMPOSE_PROJECT=<project name from above>
BACKUP_ROOT=/var/backups/internalgns
# Dead-man switch, optional but recommended (see Alerts)
BACKUP_PING_URL=https://hc-ping.com/<uuid>
```

Schedule it with a systemd timer. `OnCalendar` takes a time zone, so the run
lands at 01:30 WIB whatever the host clock is set to, and `Persistent=true`
catches up on a run missed while the host was down.

```ini
# /etc/systemd/system/internalgns-backup.service
[Unit]
Description=InternalGNS nightly backup
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
EnvironmentFile=/etc/internalgns-backup.env
ExecStart=/opt/internalgns-ops/backup.sh
```

```ini
# /etc/systemd/system/internalgns-backup.timer
[Unit]
Description=InternalGNS nightly backup at 01:30 WIB

[Timer]
OnCalendar=*-*-* 01:30:00 Asia/Jakarta
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
systemctl daemon-reload
systemctl enable --now internalgns-backup.timer
systemctl start internalgns-backup.service      # first run now
journalctl -u internalgns-backup.service -n 20  # ends with "backup ok: ..."
```

From a clone, `make backup` runs the same script with the same variables.

## Alerts

`BACKUP_PING_URL` turns the job into a dead-man switch. The script calls
`<url>/start` when it begins, `<url>` on success and `<url>/fail` on any failure,
including the disk guard. The monitor alerts when a success is late or a
failure arrives. healthchecks.io works on its free plan and uses exactly these
suffixes. Set the check's period to one day and its grace to two hours. Give
the URL without a trailing slash.

A backup that nobody watches fails silently. Without this URL the only
signal is `journalctl`.

## Off-box copy (not automated yet)

Every copy above lives on the same disk as the data. It protects against
`docker compose down -v`, a bad migration or a deleted row. It does not
protect against losing the disk or the VPS. Until a second location is chosen,
F2 is only half closed.

Once a destination exists, the boring option is restic, which encrypts and
deduplicates. Run it after the backup, for example as a second `ExecStart=`
line:

```bash
# once: restic -r sftp:backup@<other-host>:/srv/restic/internalgns init
restic -r sftp:backup@<other-host>:/srv/restic/internalgns backup /var/backups/internalgns/daily
restic -r sftp:backup@<other-host>:/srv/restic/internalgns forget --keep-daily 7 --keep-weekly 4 --prune
```

Keep the restic password out of the repository and away from the VPS disk it
protects, for example in the company password manager.

## Restore rehearsal (monthly, and before a risky deploy)

This restores the newest snapshot next to production, into a new database and
a new bucket, and compares it with the manifest the backup wrote. Production
data is only read.

```bash
set -a; . /etc/internalgns-backup.env; set +a
SNAP=$(ls -d /var/backups/internalgns/daily/*/ | tail -1)
/opt/internalgns-ops/restore.sh "$SNAP" gns_restore_check restore-rehearsal
```

It refuses a database that already exists and a bucket that is not empty, and
it checks both before writing anything. After loading, it prints a `diff`
wherever the restored row counts, object counts or bytes differ from
`postgres.counts` and `minio.counts`, and exits non-zero. The last line of a
good run reads:

```
restore ok: 22 tables, 24806 rows, 73 objects, 130194 bytes
```

Clean up the same day. The next backup would otherwise copy the rehearsal
bucket as well:

```bash
PG=$(docker ps -q --filter label=com.docker.compose.project=$COMPOSE_PROJECT --filter label=com.docker.compose.service=gns-postgres)
MINIO=$(docker ps -q --filter label=com.docker.compose.project=$COMPOSE_PROJECT --filter label=com.docker.compose.service=gns-minio)
docker exec "$PG" sh -c 'dropdb -U "$POSTGRES_USER" gns_restore_check'
docker exec "$MINIO" sh -c 'command -v mcli >/dev/null || mcli() { mc "$@"; }; mcli alias set l http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && mcli rb --force l/restore-rehearsal'
```

Write the date and the `restore ok` line in the log at the end of this page.

## Disaster restore

This is for when the volumes are gone or unusable. It follows the path
rehearsed below, on a stack with fresh volumes.

1. Deploy the stack with the same `TAG` the backup was taken on, or a newer
   one. The api migrates forward on boot, never back, so an older image would
   meet a newer schema.
2. Stop the api and web containers so nothing writes during the restore.
   The api has already migrated the new, empty database on its first start;
   the next step drops that database:
   `docker stop <project>-api-1 <project>-frontend-1`.
3. Drop the empty database that Postgres created on first start:
   `docker exec <project>-gns-postgres-1 sh -c 'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB"'`.
4. Restore into that name. Without a bucket argument, objects go back to their
   own buckets:
   `COMPOSE_PROJECT=<project> /opt/internalgns-ops/restore.sh <snapshot> <DB_NAME>`.
5. Start the api and web again (Dokploy **Deploy**, or `docker start`), then
   check `https://<API_HOST>/readyz`, log in, open a quotation PDF and a client
   logo.

Never run the orphan-blob sweeper with deletion enabled
(`orphan-blobs --dry-run=false`, or the cleanup workflow with purge) against a
database restored from an older backup. Objects uploaded after that backup
have no row in the restored database, so the sweeper would delete exactly the
files that the database is missing. Take a fresh backup of the restored
system first, and review a dry run before any purge.

MinIO object metadata such as Content-Type is not kept in the copy. The api
derives the type from the allow-listed file extension when it serves a
download, so nothing reads the stored value.

## Rehearsal log

| Date | Where | Result |
|---|---|---|
| 2026-09-25 | Local, `compose.prod.yml` with images built from this branch behind Traefik v3.6.7, seeded from a dump of the dev database (863 quotations, 143 invoices, 73 objects) | Backup and rehearsal restore match (table below). Disaster restore into a fresh stack: api healthy, `/readyz` 200, login, quotation PDF 200 (179 KB), client logo 200, `X-Total-Count` 863 quotations |
| 2026-09-26 | Local dev stack after the switch to `pgsty/silo:RELEASE.2026-09-16T00-00-00Z` on the existing volume, scripts calling `mcli` | Backup `ok` (22 tables, 212 objects). Rehearsal restore into `gns_silo_restore_test` and bucket `silo-restore-rehearsal`: `restore ok: 22 tables, 36050 rows, 212 objects, 145608 bytes`. A second run into the same bucket refused before writing |
| 2026-09-26 | Throwaway stack on the cached `minio/minio:RELEASE.2025-09-07T16-13-09Z`, which has `mc` but no `mcli` | That Silo snapshot restored into its own buckets and into bucket `old-rehearsal`: `restore ok: 22 tables, 36050 rows, 212 objects, 145608 bytes` both times. A backup from it: `backup ok`, 424 objects, with the same `minio.counts` per original bucket as the Silo backup |
| (first production run) | VPS | pending |

Source (api stopped) against the restored database and bucket, counted outside
the scripts:

```
table                              source restored
public.company_client                 188      188 ok
public.company_contacts               214      214 ok
public.countries                      251      251 ok
public.doc_sequences                  400      400 ok
public.goose_db_version                65       65 ok
public.invoice_items                  388      388 ok
public.invoice_status_history          49       49 ok
public.invoices                       143      143 ok
public.item_request_matches          3193     3193 ok
public.items                         3444     3444 ok
public.po_status_history              470      470 ok
public.purchase_order_items           421      421 ok
public.purchase_orders                174      174 ok
public.quotation_item_requests       3763     3763 ok
public.quotation_items               3964     3964 ok
public.quotation_status_history      1860     1860 ok
public.quotations                     863      863 ok
public.refresh_tokens                 425      425 ok
public.units                           40       40 ok
public.users                          559      559 ok
public.vendor_products               2690     2690 ok
public.vendors                       1242     1242 ok
total                               24806    24806

bucket               source(objects/bytes) restored(objects/bytes)
client-logos         10/1024 10/1024 ok
invoice-attachments  32/1088 32/1088 ok
po-docs              31/128082 31/128082 ok
```

The ETags of all 73 restored objects matched their sources. The public schema
had 71 functions in both databases. The restore also refused an existing
database, a non-empty bucket and a snapshot with one byte appended to the dump
(checksum mismatch), each before writing anything.

A second run took the backup while a loop committed an insert into a probe
table and an update to `units` on every iteration. The probe table grew from
1,294 to 2,470 rows during the backup, and the manifest recorded 1,429. The
restore of that snapshot still printed `restore ok: 23 tables, 26227 rows,
70 objects, 129990 bytes`, because the counts and the dump share one snapshot.
