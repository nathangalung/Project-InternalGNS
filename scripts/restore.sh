#!/usr/bin/env bash
# Restore and verify one snapshot.
#
# Usage: restore.sh SNAPSHOT_DIR TARGET_DB [TARGET_BUCKET]
#
#   TARGET_DB      created by this script; refused when it already exists, so
#                  a restore can never land on top of live data. For a real
#                  restore, stop the api and drop the empty database first.
#   TARGET_BUCKET  rehearsal mode: every object goes into this one bucket as
#                  <bucket>/<key>. Without it, objects return to their own
#                  buckets, which must be empty.
#
# After loading, it compares exact row counts with postgres.counts and object
# counts and bytes with minio.counts, and exits non-zero on any difference.
# Docs: docs/backup_restore.md.
# The single-quoted mc scripts expand inside the MinIO container.
# shellcheck disable=SC2016
set -euo pipefail
umask 077

COMPOSE_PROJECT=${COMPOSE_PROJECT:-}
PG_SERVICE=${PG_SERVICE:-gns-postgres}
MINIO_SERVICE=${MINIO_SERVICE:-gns-minio}

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/backup-lib.sh
. "$SCRIPT_DIR/backup-lib.sh"

[ $# -ge 2 ] || die "usage: restore.sh SNAPSHOT_DIR TARGET_DB [TARGET_BUCKET]"
snap=$(cd "$1" && pwd)
db=$2
bucket=${3:-}
[[ "$db" =~ ^[a-z_][a-z0-9_]*$ ]] || die "TARGET_DB must be a plain lowercase identifier"
[ -z "$bucket" ] || [[ "$bucket" =~ ^[a-z0-9][a-z0-9.-]{2,62}$ ]] || die "TARGET_BUCKET is not a valid bucket name"

log "verifying checksums in $snap"
(cd "$snap" && sha256sum --quiet -c SHA256SUMS) || die "checksum mismatch in $snap"

pg=$(container_for "$PG_SERVICE")
minio=$(container_for "$MINIO_SERVICE")
minio_image=$(docker inspect -f '{{.Config.Image}}' "$minio")

# Refuse before writing anything, so a refusal never leaves half a restore.
targets=$bucket
[ -n "$targets" ] || targets=$(find "$snap/minio" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort)
exists=$(docker exec "$pg" sh -c 'psql -X -At -U "$POSTGRES_USER" -d postgres -c "SELECT 1 FROM pg_database WHERE datname = '"'$db'"'"')
[ -z "$exists" ] || die "database $db already exists; restore only into a new database"
mc_run "$minio" "$minio_image" '
  for b in $TARGETS; do
    if mc ls "src/$b" >/dev/null 2>&1 && [ -n "$(mc ls --recursive "src/$b")" ]; then
      echo "bucket $b is not empty" >&2
      exit 1
    fi
  done' -e "TARGETS=$targets" || die "restore only into empty buckets"

log "restoring postgres into $db"
docker exec "$pg" sh -c 'exec createdb -U "$POSTGRES_USER" -O "$POSTGRES_USER" "$1"' sh "$db"
docker exec -i "$pg" sh -c 'exec pg_restore -U "$POSTGRES_USER" -d "$1" --no-owner --exit-on-error' sh "$db" \
  <"$snap/postgres.dump"

restored_rows=$(mktemp)
restored_objects=$(mktemp)
trap 'rm -f "$restored_rows" "$restored_objects"' EXIT
pg_row_counts "$pg" "$db" >"$restored_rows"

log "restoring objects"
if [ -n "$bucket" ]; then
  mc_run "$minio" "$minio_image" '
    mc mb --ignore-existing "src/$BUCKET" >/dev/null
    mc mirror --quiet /snap "src/$BUCKET" >/dev/null' \
    -e "BUCKET=$bucket" -v "$snap/minio:/snap:ro"
  minio_object_counts "$minio" "$minio_image" "$bucket" >"$restored_objects"
else
  mc_run "$minio" "$minio_image" '
    for d in /snap/*/; do
      b=$(basename "$d")
      mc mb --ignore-existing "src/$b" >/dev/null
      mc mirror --quiet "$d" "src/$b" >/dev/null
    done' -v "$snap/minio:/snap:ro"
  minio_object_counts "$minio" "$minio_image" >"$restored_objects"
fi

# Empty buckets list nothing, so compare only non-empty ones.
expected_objects=$(awk '$2 > 0' "$snap/minio.counts" | sort)
fail=0
if ! diff <(sort "$snap/postgres.counts") <(sort "$restored_rows"); then
  log "row counts differ (snapshot on the left, restored on the right)"
  fail=1
fi
if ! diff <(printf '%s\n' "$expected_objects") <(sort "$restored_objects"); then
  log "object counts differ (snapshot on the left, restored on the right)"
  fail=1
fi
[ "$fail" -eq 0 ] || die "restore of $snap does not match its manifest"

log "restore ok: $(wc -l <"$restored_rows") tables, $(awk '{n += $2} END {print n + 0}' "$restored_rows") rows, $(awk '{n += $2; s += $3} END {print n + 0 " objects, " s + 0 " bytes"}' "$restored_objects")"
