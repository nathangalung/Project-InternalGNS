#!/usr/bin/env bash
# Set Dokploy release TAG.
#
# Usage: DEPLOY_SSH=user@host scripts/dokploy-set-tag.sh vX.Y.Z
#
# Changes only the TAG line of the InternalGNS compose app's saved
# environment. It refuses a tag that is not vMAJOR.MINOR.PATCH, and one whose
# api or web image the VPS cannot pull. The previous row is saved under
# ~/dokploy-env-backups on the VPS (mode 600) before the update. Nothing is
# deployed here: the next push to main, or Deploy in the Dokploy UI, rolls
# the new TAG out.
#
# Required: DEPLOY_SSH, the VPS login (user@host or an ssh config alias).
# Overridable: DEPLOY_SSH_PORT (ssh default: 22, or the alias's Port),
# DOKPLOY_APP (internalgns-stack-vse6fd), GHCR_OWNER (nathangalung).
set -euo pipefail

tag="${1:-}"
if [[ ! "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: DEPLOY_SSH=user@host $0 vX.Y.Z" >&2
  exit 2
fi

# Read unset values from .deploy.local.
# That file sits at the repo root, is gitignored, and holds KEY=value lines;
# only DEPLOY_SSH and DEPLOY_SSH_PORT are read, and nothing is executed.
local_env="$(cd "$(dirname "$0")/.." && pwd)/.deploy.local"
if [[ -f "$local_env" ]]; then
  while IFS='=' read -r key value; do
    value="${value%$'\r'}"
    case "$key" in
      DEPLOY_SSH) [[ -z "${DEPLOY_SSH:-}" ]] && DEPLOY_SSH="$value" ;;
      DEPLOY_SSH_PORT) [[ -z "${DEPLOY_SSH_PORT:-}" ]] && DEPLOY_SSH_PORT="$value" ;;
    esac
  done <"$local_env"
fi

host="${DEPLOY_SSH:-}"
if [[ -z "$host" ]]; then
  echo "DEPLOY_SSH is not set; export the VPS login or put DEPLOY_SSH=user@host in .deploy.local" >&2
  exit 2
fi
if [[ ! "$host" =~ ^[A-Za-z0-9._-]+(@[A-Za-z0-9._-]+)?$ || ! "${DEPLOY_SSH_PORT:-22}" =~ ^[0-9]+$ ]]; then
  echo "invalid DEPLOY_SSH or DEPLOY_SSH_PORT" >&2
  exit 2
fi
# Pass -p only when set, so an ssh config alias keeps its Port.
ssh_opts=(-o BatchMode=yes)
if [[ -n "${DEPLOY_SSH_PORT:-}" ]]; then
  ssh_opts+=(-p "$DEPLOY_SSH_PORT")
fi
app="${DOKPLOY_APP:-internalgns-stack-vse6fd}"
owner="${GHCR_OWNER:-nathangalung}"
if [[ ! "$app" =~ ^[a-z0-9-]+$ || ! "$owner" =~ ^[A-Za-z0-9-]+$ ]]; then
  echo "invalid DOKPLOY_APP or GHCR_OWNER" >&2
  exit 2
fi

ssh "${ssh_opts[@]}" "$host" bash -s -- "$tag" "$app" "$owner" <<'REMOTE'
set -euo pipefail
tag="$1" app="$2" owner="$3"

for svc in api web; do
  if ! docker manifest inspect "ghcr.io/$owner/internalgns-$svc:$tag" >/dev/null 2>&1; then
    echo "image ghcr.io/$owner/internalgns-$svc:$tag is not pullable; TAG unchanged" >&2
    exit 1
  fi
done

pg=$(docker ps --format '{{.Names}}' | grep -m1 dokploy-postgres)
q() { docker exec -i "$pg" psql -U dokploy -d dokploy -v ON_ERROR_STOP=1 -At "$@"; }

before=$(q -v app="$app" <<'SQL'
SELECT env FROM compose WHERE "appName" = :'app';
SQL
)
if [[ -z "$before" ]]; then
  echo "no compose app named $app" >&2
  exit 1
fi
if [[ $(grep -c '^TAG=' <<<"$before") -ne 1 ]]; then
  echo "expected exactly one TAG line in $app; TAG unchanged" >&2
  exit 1
fi

umask 077
mkdir -p "$HOME/dokploy-env-backups"
backup="$HOME/dokploy-env-backups/$app-$(date -u +%Y%m%dT%H%M%SZ).env"
printf '%s\n' "$before" >"$backup"

q -v app="$app" -v tag="$tag" >/dev/null <<'SQL'
UPDATE compose
SET env = regexp_replace(env, '(^|\n)TAG=[^\n]*', '\1TAG=' || :'tag')
WHERE "appName" = :'app';
SQL

after=$(q -v app="$app" <<'SQL'
SELECT env FROM compose WHERE "appName" = :'app';
SQL
)
echo "$(grep -m1 '^TAG=' <<<"$before" | sed 's/[[:space:]]*$//') -> $(grep -m1 '^TAG=' <<<"$after")"
changed=$({ diff <(printf '%s\n' "$before" | sed 's/[[:space:]]*$//') <(printf '%s\n' "$after") || true; } | { grep -E '^[<>] ' || true; } | sed -E 's/^[<>] ([A-Za-z0-9_]+)=.*/\1/' | sort -u | tr '\n' ' ')
echo "changed keys: ${changed:-none}"
echo "backup: $backup"
REMOTE
