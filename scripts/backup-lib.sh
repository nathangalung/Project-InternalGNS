# Shared backup script helpers.
# shellcheck shell=bash

log() { printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >&2; }

die() {
  log "error: $*"
  exit 1
}

# Resolve one service container.
container_for() {
  # Dokploy may run the stack under its own project name, so the service
  # label is the stable handle; COMPOSE_PROJECT narrows it when several match.
  local filters=(--filter "label=com.docker.compose.service=$1")
  [ -z "${COMPOSE_PROJECT:-}" ] || filters+=(--filter "label=com.docker.compose.project=$COMPOSE_PROJECT")
  local ids
  ids=$(docker ps -q "${filters[@]}")
  [ -n "$ids" ] || die "no running container for service $1${COMPOSE_PROJECT:+ in project $COMPOSE_PROJECT}"
  [ "$(wc -l <<<"$ids")" -eq 1 ] || die "several containers run service $1; set COMPOSE_PROJECT"
  printf '%s\n' "$ids"
}

# Read one container variable.
minio_env() {
  docker exec "$1" printenv "$2" || die "$2 is not set in container $1"
}

# Run mcli beside MinIO.
mcli_run() {
  # Usage: mcli_run CONTAINER IMAGE SCRIPT [docker run args...]. The one-off
  # container shares MinIO's network namespace, so it reaches 127.0.0.1:9000
  # on the internal-only network. Credentials pass by name, never in argv.
  # Silo ships mcli; the old minio/minio image ships only mc, so mcli falls
  # back to it before the Silo deploy and after a rollback.
  local minio=$1 image=$2 script=$3
  shift 3
  MINIO_ROOT_USER=$(minio_env "$minio" MINIO_ROOT_USER) \
    MINIO_ROOT_PASSWORD=$(minio_env "$minio" MINIO_ROOT_PASSWORD) \
    docker run --rm --network "container:$minio" --user "$(id -u):$(id -g)" \
    -e MC_CONFIG_DIR=/tmp/mc -e MINIO_ROOT_USER -e MINIO_ROOT_PASSWORD "$@" \
    --entrypoint sh "$image" -c \
    'set -e; command -v mcli >/dev/null 2>&1 || mcli() { mc "$@"; }
    mcli alias set src http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && '"$script"
}

# Per-table count query.
pg_count_sql() {
  # psql prints "<schema.table> <rows>" per table through \gexec.
  cat <<'SQL'
SELECT format('SELECT %L, count(*) FROM %I.%I', n.nspname || '.' || c.relname, n.nspname, c.relname)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
ORDER BY 1
\gexec
SQL
}

# Exact rows per table.
pg_row_counts() {
  # Usage: pg_row_counts CONTAINER DATABASE (empty means POSTGRES_DB).
  pg_count_sql | docker exec -i "$1" sh -c \
    'exec psql -X -q -At -F " " -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "${1:-$POSTGRES_DB}"' sh "$2"
}

# Objects and bytes per bucket.
minio_object_counts() {
  # Usage: minio_object_counts CONTAINER IMAGE [BUCKET]. Groups by the first
  # key segment: the bucket at the alias root, and the original bucket inside
  # a rehearsal bucket. Prints "<bucket> <objects> <bytes>" sorted.
  mcli_run "$1" "$2" 'mcli ls --recursive --json "src/'"${3:-}"'"' |
    awk -F'"' '
      { key = ""; size = 0
        for (i = 1; i < NF; i++) {
          if ($i == "key") key = $(i + 2)
          if ($i == "size") { s = $(i + 1); gsub(/[^0-9]/, "", s); size = s }
        }
        if (key == "" || key ~ /\/$/) next
        split(key, parts, "/"); b = parts[1]; n[b]++; bytes[b] += size }
      END { for (b in n) printf "%s %d %d\n", b, n[b], bytes[b] }' | sort
}

# Files and bytes per directory.
dir_object_counts() {
  local d
  for d in "$1"/*/; do
    [ -d "$d" ] || continue
    printf '%s %d %d\n' "$(basename "$d")" \
      "$(find "$d" -type f | wc -l)" \
      "$(find "$d" -type f -printf '%s\n' | awk '{s += $1} END {print s + 0}')"
  done
}

# Keep the newest N snapshots.
prune() {
  local dir=$1 keep=$2
  find "$dir" -mindepth 1 -maxdepth 1 -type d ! -name '*.partial' | sort | head -n "-$keep" |
    while read -r old; do
      log "pruning $old"
      rm -rf -- "$old"
    done
}
