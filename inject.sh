#!/usr/bin/env bash
# inject.sh — claude-phase-5.md Part 2 failure-injection orchestrator.
# Usage: ./inject.sh <scenario> <start|stop>
#
# Requires ENABLE_DEBUG_ROUTES=true on the backend for every scenario except
# backend-outage/mysql-outage/flapping/refused (pure Docker CLI, no debug API
# involved) — see observability/docker-compose.yml's commented-out
# ENABLE_DEBUG_ROUTES line and .env.example in expense-backend-v1.
set -euo pipefail

# claude-phase-5.md's own example hardcodes http://localhost:3000 — wrong on
# two counts for this app: the backend's real port is 4000, not 3000, and
# more importantly it isn't published to the host at all (only nginx's port
# 80 is — observability/docker-compose.yml, README's "nginx proxies to the
# backend" section). Routing through nginx's existing /api/ location instead
# needs no docker-compose changes and matches how every other real client
# (browser, k6) already reaches this backend.
BASE_URL="${BASE_URL:-http://localhost}"
API="$BASE_URL/api"

# Actual `container_name:` values from observability/docker-compose.yml —
# claude-phase-5.md's example script uses "expense-backend", which doesn't
# exist; the real name is "backend" (mysql and frontend's names did match:
# "expense-mysql", "frontend").
BACKEND_CONTAINER="backend"
MYSQL_CONTAINER="expense-mysql"

case "$1-$2" in

  backend-outage-start)
    docker stop "$BACKEND_CONTAINER"
    ;;
  backend-outage-stop)
    docker start "$BACKEND_CONTAINER"
    ;;

  mysql-outage-start)
    docker stop "$MYSQL_CONTAINER"
    ;;
  mysql-outage-stop)
    docker start "$MYSQL_CONTAINER"
    ;;

  pool-exhaustion-start)
    curl -fsS -X POST "$API/debug/pool/resize" \
      -H "Content-Type: application/json" -d '{"size": 5}'
    ;;
  pool-exhaustion-stop)
    curl -fsS -X POST "$API/debug/pool/resize" \
      -H "Content-Type: application/json" -d '{"size": 10}'
    ;;

  n-plus-one-start)
    curl -fsS -X POST "$API/debug/inject/n-plus-one" \
      -H "Content-Type: application/json" -d '{"enabled": true}'
    ;;
  n-plus-one-stop)
    curl -fsS -X POST "$API/debug/inject/n-plus-one" \
      -H "Content-Type: application/json" -d '{"enabled": false}'
    ;;

  resource-exhaustion-start)
    curl -fsS -X POST "$API/debug/inject/busy-loop" \
      -H "Content-Type: application/json" -d '{"enabled": true}'
    ;;
  resource-exhaustion-stop)
    curl -fsS -X POST "$API/debug/inject/busy-loop" \
      -H "Content-Type: application/json" -d '{"enabled": false}'
    ;;

  flapping-start)
    echo "Flapping $BACKEND_CONTAINER every ~30s — Ctrl+C to stop"
    trap 'docker start "$BACKEND_CONTAINER" >/dev/null 2>&1 || true; echo; echo "left $BACKEND_CONTAINER running — exiting"' EXIT
    while true; do
      docker stop "$BACKEND_CONTAINER"; sleep 15
      docker start "$BACKEND_CONTAINER"; sleep 15
    done
    ;;
  flapping-stop)
    # No background process to signal (flapping-start blocks in the
    # foreground; Ctrl+C is the real way to stop it, and its own trap above
    # already leaves the container running) — this is just a safety net in
    # case a previous run was killed some other way and left it stopped.
    docker start "$BACKEND_CONTAINER" >/dev/null 2>&1 || true
    ;;

  refused-start)
    docker stop "$BACKEND_CONTAINER"
    ;;
  refused-stop)
    docker start "$BACKEND_CONTAINER"
    ;;

  # claude-phase-5.md's example uses `docker exec ... iptables` — the
  # backend's image (node:24-alpine, expense-backend-v1/Dockerfile) doesn't
  # have iptables installed, and the container isn't granted NET_ADMIN
  # either, so that command would just fail. Reimplemented as a debug-API
  # toggle instead (expense-backend-v1/src/middleware/debugInjections.js):
  # while on, matching requests are simply never answered — no res.end(),
  # connection left open. From nginx's point of view this is a genuine
  # timeout (its own proxy_read_timeout eventually returns 504), which is
  # exactly the "fails slow" signature this scenario needs to contrast
  # against "refused" above — without a permanent capability grant on the
  # backend container for the sake of one demo.
  timeout-start)
    curl -fsS -X POST "$API/debug/inject/timeout" \
      -H "Content-Type: application/json" -d '{"enabled": true}'
    ;;
  timeout-stop)
    curl -fsS -X POST "$API/debug/inject/timeout" \
      -H "Content-Type: application/json" -d '{"enabled": false}'
    ;;

  cardinality-bomb-start)
    curl -fsS -X POST "$API/debug/inject/bad-cardinality" \
      -H "Content-Type: application/json" -d '{"enabled": true}'
    ;;
  cardinality-bomb-stop)
    curl -fsS -X POST "$API/debug/inject/bad-cardinality" \
      -H "Content-Type: application/json" -d '{"enabled": false}'
    ;;

  status)
    curl -fsS "$API/debug/status"
    ;;

  *)
    echo "Unknown scenario/action: ${1-} ${2-}"
    echo "Scenarios: backend-outage, mysql-outage, pool-exhaustion, n-plus-one,"
    echo "           resource-exhaustion, flapping, refused, timeout, cardinality-bomb"
    echo "Also: ./inject.sh status  (GET /debug/status through nginx)"
    exit 1
    ;;
esac
