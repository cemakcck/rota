#!/usr/bin/env bash
# Smoke test of the production image: runs it against the local compose database (npm run db:up) and
# checks what the container must serve, including the files routes read at runtime.
#
#   docker build -t rota . && scripts/docker-smoke.sh
#
# IMAGE, PORT (default 3402) and DATABASE_URL override the defaults. Uses the host network so the
# container reaches Postgres on localhost:5434. The container is stopped and removed by its id.
set -euo pipefail

IMAGE="${IMAGE:-rota}"
PORT="${PORT:-3402}"
DATABASE_URL="${DATABASE_URL:-postgres://rota:rota@localhost:5434/rota}"
BASE="http://localhost:$PORT"

id=$(docker run -d --network host \
  -e PORT="$PORT" \
  -e DATABASE_URL="$DATABASE_URL" \
  -e BETTER_AUTH_SECRET=smoke-only-secret-smoke-only-secret-1234 \
  -e BETTER_AUTH_URL="$BASE" \
  -e IP_HASH_SECRET=smoke-ip-secret \
  "$IMAGE")
body=$(mktemp)
cleanup() { docker stop "$id" >/dev/null; docker rm "$id" >/dev/null; rm -f "$body"; }
trap cleanup EXIT

fail() { echo "FAIL: $*"; echo "--- container log"; docker logs "$id" 2>&1 | tail -40; exit 1; }

for _ in $(seq 1 60); do
  curl -sf "$BASE/api/health" >/dev/null && break
  sleep 1
done

check() { # path, expected status, content-type pattern
  local status type
  read -r status type < <(curl -s -o "$body" -w '%{http_code} %{content_type}\n' "$BASE$1")
  [[ "$status" == "$2" ]] || fail "$1: status $status, expected $2"
  [[ "$type" =~ $3 ]] || fail "$1: content-type '$type' does not match '$3'"
  echo "ok  $1  $status  $type"
}

check /api/health 200 '^application/json'
grep -q '"ok":true' "$body" || fail "/api/health body: $(cat "$body")"
check /en 200 '^text/html'
check /maplibre-gl-worker.mjs 200 'javascript'
[[ $(wc -c <"$body") -gt 1000 ]] || fail "/maplibre-gl-worker.mjs is too small"
check /sw.js 200 'javascript'
build_id=$(docker exec "$id" cat .next/BUILD_ID)
grep -q "const VERSION = \"$build_id\";" "$body" || fail "/sw.js does not carry BUILD_ID $build_id"
echo "ok  /sw.js names build $build_id"
docker logs "$id" 2>&1 | grep -q "Migrated." || fail "migrations did not run before the server"
echo "ok  migrations ran at start"
# A demo start writes to the database and seeds a trip document through the sync server's Yjs.
status=$(curl -s -o "$body" -w '%{http_code}' -X POST "$BASE/api/demo" -H "origin: $BASE" -H 'content-type: application/json' -d '{"locale":"en"}')
[[ "$status" == 201 ]] || fail "POST /api/demo: $status $(cat "$body")"
echo "ok  POST /api/demo  201"
echo "Docker smoke passed."
