#!/usr/bin/env bash
# Docker smoke test: builds the image (unless IMAGE is set and SKIP_BUILD=1), runs it
# like compose.yaml does and checks non-root user, HEALTHCHECK, binding on the LAN IP,
# the separate MCP port and /data persistence across a container restart.
set -euo pipefail

IMAGE="${IMAGE:-life-hub:test}"
NAME="life-hub-smoke"
VOLUME="life-hub-smoke-data"
APP_PORT="${APP_PORT:-4700}"
MCP_PORT="${MCP_PORT:-4701}"
TOKEN="smoke-token-0123456789abcdefghijklmnopqrstuv"
LAN_IP="$(ip -4 -o addr show scope global | awk '{split($4, a, "/"); print a[1]; exit}')"

cleanup() {
	docker rm -f "$NAME" >/dev/null 2>&1 || true
	docker volume rm -f "$VOLUME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
	echo "FAIL: $*" >&2
	docker logs "$NAME" >&2 || true
	exit 1
}

wait_healthy() {
	for _ in $(seq 1 60); do
		status="$(docker inspect -f '{{.State.Health.Status}}' "$NAME")"
		[ "$status" = "healthy" ] && return 0
		sleep 1
	done
	fail "container did not become healthy (status: $status)"
}

[ -n "$LAN_IP" ] || fail "no LAN IP found"
if [ "${SKIP_BUILD:-0}" != "1" ]; then
	docker build -t "$IMAGE" .
fi
cleanup

docker run -d --name "$NAME" \
	--read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true \
	-p "$APP_PORT:3000" -p "$MCP_PORT:3001" \
	-v "$VOLUME:/data" \
	-e "ALLOWED_HOSTS=$LAN_IP" \
	-e "MCP_AUTH_TOKEN=$TOKEN" \
	"$IMAGE" >/dev/null

wait_healthy
echo "ok: HEALTHCHECK reports healthy"

uid="$(docker exec "$NAME" id -u)"
[ "$uid" != "0" ] || fail "container runs as root"
echo "ok: runs as UID $uid"

code="$(curl -s -o /dev/null -w '%{http_code}' "http://$LAN_IP:$APP_PORT/api/v1/health")"
[ "$code" = "200" ] || fail "health via LAN IP returned $code"
echo "ok: reachable via LAN IP $LAN_IP:$APP_PORT"

code="$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.example' "http://$LAN_IP:$APP_PORT/api/v1/health")"
[ "$code" = "403" ] || fail "foreign Host header returned $code"
echo "ok: foreign Host header rejected"

init='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}'
mcp() {
	curl -s -o /dev/null -w '%{http_code}' -X POST "http://$LAN_IP:$MCP_PORT/mcp" \
		-H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' "$@" -d "$init"
}
[ "$(mcp)" = "401" ] || fail "MCP without token did not return 401"
[ "$(mcp -H 'Authorization: Bearer wrong-token-0123456789abcdefghijklmnop')" = "403" ] || fail "MCP with wrong token did not return 403"
[ "$(mcp -H "Authorization: Bearer $TOKEN")" = "200" ] || fail "MCP initialize with token failed"
code="$(curl -s -o /dev/null -w '%{http_code}' "http://$LAN_IP:$MCP_PORT/api/v1/health")"
[ "$code" = "404" ] || fail "API reachable on MCP port ($code)"
echo "ok: MCP on separate port with bearer auth, no API there"

curl -sf -X POST "http://$LAN_IP:$APP_PORT/api/v1/tasks" \
	-H "Origin: http://$LAN_IP:$APP_PORT" -H 'Content-Type: application/json' \
	-d '{"title":"Smoke-Test bleibt erhalten"}' >/dev/null || fail "creating a task failed"
docker restart "$NAME" >/dev/null
wait_healthy
curl -sf "http://$LAN_IP:$APP_PORT/api/v1/tasks" | grep -q 'Smoke-Test bleibt erhalten' || fail "task lost after restart"
echo "ok: /data persists across container restart"

docker exec "$NAME" sh -c 'ls /data/backups | grep -q daily-' || fail "no daily backup in /data/backups"
echo "ok: daily backup written"
echo "Docker smoke test passed"
