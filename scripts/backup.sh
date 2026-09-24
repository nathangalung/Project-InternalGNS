#!/usr/bin/env bash
# Nightly Postgres and MinIO backup.
#
# Runs on the Docker host, never inside the stack: the stack's network is
# internal-only, and the copies belong on the host filesystem. The database is
# dumped first so every object key it references was already uploaded when
# the objects are copied. Each run writes a new snapshot directory:
#
#   $BACKUP_ROOT/daily/<stamp>/postgres.dump    pg_dump -Fc
#   $BACKUP_ROOT/daily/<stamp>/postgres.toc     pg_restore -l of the dump
#   $BACKUP_ROOT/daily/<stamp>/postgres.counts  exact rows per table
#   $BACKUP_ROOT/daily/<stamp>/minio/<bucket>/  every object, as files
#   $BACKUP_ROOT/daily/<stamp>/minio.counts     objects and bytes per bucket
#   $BACKUP_ROOT/daily/<stamp>/SHA256SUMS
#
# Sunday snapshots are also linked into weekly/. Files are never modified
# after a snapshot is finalised, so the hard links cannot alias a change.
# Docs: docs/backup_restore.md.
# The single-quoted mc scripts expand inside the MinIO container.
# shellcheck disable=SC2016
set -euo pipefail
umask 077

BACKUP_ROOT=${BACKUP_ROOT:-/var/backups/internalgns}
COMPOSE_PROJECT=${COMPOSE_PROJECT:-}
PG_SERVICE=${PG_SERVICE:-gns-postgres}
MINIO_SERVICE=${MINIO_SERVICE:-gns-minio}
KEEP_DAILY=${KEEP_DAILY:-7}
KEEP_WEEKLY=${KEEP_WEEKLY:-4}
DISK_MAX_PCT=${DISK_MAX_PCT:-85}
BACKUP_PING_URL=${BACKUP_PING_URL:-}

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/backup-lib.sh
. "$SCRIPT_DIR/backup-lib.sh"

# Report outcome to the monitor.
ping_monitor() {
  [ -n "$BACKUP_PING_URL" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "${BACKUP_PING_URL}$1" || log "ping ${BACKUP_PING_URL}$1 failed"
}

# Any non-zero exit, die included, alerts.
on_exit() {
  local rc=$?
  [ "$rc" -eq 0 ] && return
  log "backup FAILED (exit $rc)"
  ping_monitor /fail
}
trap on_exit EXIT

mkdir -p "$BACKUP_ROOT/daily" "$BACKUP_ROOT/weekly"
exec 9>"$BACKUP_ROOT/.lock"
flock -n 9 || die "another backup holds $BACKUP_ROOT/.lock"
ping_monitor /start

# A dump written onto a nearly full disk can starve Postgres of space for its
# own WAL. Refuse and alert instead.
for path in "$BACKUP_ROOT" "$(docker info -f '{{.DockerRootDir}}')"; do
  used=$(df --output=pcent "$path" | tail -1 | tr -dc '0-9')
  [ "$used" -lt "$DISK_MAX_PCT" ] || die "disk at ${used}% on $path (limit ${DISK_MAX_PCT}%)"
done

pg=$(container_for "$PG_SERVICE")
minio=$(container_for "$MINIO_SERVICE")
minio_image=$(docker inspect -f '{{.Config.Image}}' "$minio")

stamp=$(TZ=Asia/Jakarta date +%Y-%m-%dT%H%M%S)
snap="$BACKUP_ROOT/daily/$stamp"
work="$snap.partial"
rm -rf "$BACKUP_ROOT"/daily/*.partial
mkdir -p "$work/minio"

log "dumping postgres from $pg"
docker exec "$pg" sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' >"$work/postgres.dump"
docker exec -i "$pg" pg_restore -l <"$work/postgres.dump" >"$work/postgres.toc"
[ -s "$work/postgres.toc" ] || die "pg_restore -l returned an empty table of contents"
pg_row_counts "$pg" "" >"$work/postgres.counts"

log "copying objects from $minio"
before=$(minio_object_counts "$minio" "$minio_image" | awk '{n += $2} END {print n + 0}')
# Every bucket gets a directory, so empty buckets come back on restore. The
# MinIO image has no awk or sed, hence the parameter expansion.
mc_run "$minio" "$minio_image" '
  buckets=$(mc ls src)
  printf "%s\n" "$buckets" | while IFS= read -r line; do
    [ -n "$line" ] || continue
    b=${line##* }
    b=${b%/}
    mkdir -p "/mirror/$b"
    mc mirror --quiet "src/$b" "/mirror/$b" >/dev/null
  done' -v "$work/minio:/mirror"
dir_object_counts "$work/minio" >"$work/minio.counts"
copied=$(awk '{n += $2} END {print n + 0}' "$work/minio.counts")
# Uploads may land during the copy. Only the orphan sweeper deletes, and it
# must not run during a backup, so fewer objects than before is a failure.
[ "$copied" -ge "$before" ] || die "copied $copied objects, MinIO held $before before the copy"

# shellcheck disable=SC2094 # SHA256SUMS is excluded from the list
(cd "$work" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum >SHA256SUMS)
mv "$work" "$snap"

if [ "$(TZ=Asia/Jakarta date +%u)" = 7 ]; then
  cp -al "$snap" "$BACKUP_ROOT/weekly/$stamp"
fi
prune "$BACKUP_ROOT/daily" "$KEEP_DAILY"
prune "$BACKUP_ROOT/weekly" "$KEEP_WEEKLY"

log "backup ok: $snap ($(du -sh "$snap" | cut -f1), $(wc -l <"$snap/postgres.counts") tables, $copied objects)"
ping_monitor ""
