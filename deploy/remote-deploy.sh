#!/usr/bin/env bash
# Run over SSH after uploading a git archive to INSTALLATION/incoming/REVISION.tar.gz.
set -Eeuo pipefail
umask 077

if [[ $# -ne 2 || $1 != /* || ! $2 =~ ^[0-9a-f]{40}$ ]]; then
  echo "Usage: remote-deploy.sh ABSOLUTE_INSTALLATION_PATH COMMIT_SHA" >&2
  exit 2
fi
root=$(cd "$1" && pwd -P)
revision=$2
archive="$root/incoming/$revision.tar.gz"
release="$root/releases/$revision"
previous=""
staging=""
activation_started=0

for required in "$root/deploy/.env" "$root/backend/data/raw/MANIFEST.json" "$archive"; do
  if [[ ! -f $required ]]; then
    echo "Missing deployment input: $required" >&2
    exit 1
  fi
done
if [[ ! -d $root/backend/data/processed ]]; then
  echo "Missing deployment input: $root/backend/data/processed" >&2
  exit 1
fi
if [[ -e $root/current && ! -L $root/current ]]; then
  echo "Refusing to replace a non-symlink installation/current" >&2
  exit 1
fi

exec 9>"$root/.deploy.lock"
if ! flock -n 9; then
  echo "Another deployment holds the server lock; retry this workflow later." >&2
  exit 1
fi

compose() {
  local directory=$1
  shift
  local env_args=(--env-file "$directory/deploy/.env")
  if [[ -f $directory/deploy/images.env ]]; then
    env_args+=(--env-file "$directory/deploy/images.env")
  fi
  # Compose run attaches stdin even with -T; never let it consume a streamed SSH script.
  sudo -n docker compose --project-name greenwave --project-directory "$directory" \
    "${env_args[@]}" -f "$directory/compose.production.yaml" "$@" < /dev/null
}

probe_https() {
  local domain path status
  domain=$(compose "$1" config --format json | python3 -c \
    'import json,sys; print(json.load(sys.stdin)["services"]["proxy"]["environment"]["DOMAIN"])')
  for path in / /api/v1/health; do
    status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --connect-timeout 10 --max-time 30 "https://$domain$path")
    if [[ $status != 401 ]]; then
      echo "HTTPS authentication probe failed for $path (expected 401, got $status)." >&2
      return 1
    fi
  done
}

finish() {
  local status=$?
  trap - EXIT
  set +e
  if [[ $status -ne 0 && $activation_started -eq 1 ]]; then
    echo "Activation failed; attempting rollback." >&2
    if [[ -n $previous && -f $previous/compose.production.yaml && -f $previous/deploy/.env ]] &&
       compose "$previous" up -d --no-build --wait --wait-timeout 180; then
      ln -sfn "$previous" "$root/current"
      echo "Rollback restored $previous" >&2
    else
      echo "ROLLBACK FAILED: inspect Compose logs and restore the previous release manually." >&2
    fi
  fi
  if [[ -n $staging && -d $staging ]]; then
    rm -rf -- "$staging"
  fi
  exit "$status"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

if [[ -L $root/current ]]; then
  # A failed partial activation can already have replaced the backend's Compose label.
  previous=$(cd "$root/current" && pwd -P)
else
  previous=$(sudo -n docker inspect greenwave-backend-1 \
    --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' 2>/dev/null || true)
fi
if [[ -z $previous || ! -f $previous/compose.production.yaml || ! -f $previous/deploy/.env ]]; then
  echo "Cannot identify the running GreenWave release; finish the manual deployment first." >&2
  exit 1
fi
if [[ -L $root/current && $previous == "$release" && -f $release/.revision && $(cat "$release/.revision") == "$revision" ]]; then
  compose "$release" up -d --no-build --wait --wait-timeout 180
  probe_https "$release"
  echo "Revision $revision is active and healthy; leaving its image tags unchanged."
  exit 0
fi

mkdir -p "$root/releases"
if [[ ! -e $release ]]; then
  staging=$(mktemp -d "$root/releases/.staging-$revision.XXXXXX")
  # Preserve git archive's source modes despite umask 077; image runtime users are non-root.
  tar --extract --gzip --no-same-owner --same-permissions --file "$archive" --directory "$staging"
  test -f "$staging/compose.production.yaml"
  mkdir -p "$staging/backend/data/raw" "$staging/deploy"
  # git archive includes .gitkeep and the tracked manifest; use the VM's matching live artifacts.
  rm -rf -- "$staging/backend/data/processed"
  rm -f -- "$staging/backend/data/raw/MANIFEST.json" "$staging/deploy/.env"
  ln -s "$root/backend/data/processed" "$staging/backend/data/processed"
  ln -s "$root/backend/data/raw/MANIFEST.json" "$staging/backend/data/raw/MANIFEST.json"
  ln -s "$root/deploy/.env" "$staging/deploy/.env"
  printf '%s\n' "$revision" > "$staging/.revision"
  mv "$staging" "$release"
  staging=""
fi
if [[ ! -f $release/.revision || $(cat "$release/.revision") != "$revision" ]]; then
  echo "Existing release has no matching revision marker: $release" >&2
  exit 1
fi
printf 'GREENWAVE_BACKEND_IMAGE=greenwave-backend:%s\nGREENWAVE_FRONTEND_IMAGE=greenwave-frontend:%s\n' \
  "$revision" "$revision" > "$release/deploy/images.env"

compose "$release" config --quiet
compose "$release" build --pull
# Validate artifacts, schema, permissions and routing startup using the new image and mounts
# while the old backend can still serve its in-memory dataset.
compose "$release" run --rm --no-deps -T backend python -c '
import asyncio
from greenwave.main import app

async def check():
    async with app.router.lifespan_context(app):
        print("New release dataset and routing startup validated")

asyncio.run(check())
'
if [[ ! -L $root/current ]]; then
  ln -s "$previous" "$root/current"
fi
# From here a partially successful Compose up must also trigger rollback.
activation_started=1
compose "$release" up -d --no-build --wait --wait-timeout 180
probe_https "$release"
ln -sfn "$release" "$root/current"
activation_started=0
echo "Deployed $revision successfully. Previous release: $previous"
