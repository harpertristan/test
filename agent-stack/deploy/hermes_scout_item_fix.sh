#!/usr/bin/env bash
# Apply tested Scout CRM item 404 fallback only when server code matches the reviewed baseline.
set -Eeuo pipefail
umask 077
ROOT=/srv/hermes-stack
WORK="$ROOT/deployment-source"
FILE="$WORK/agent-stack/scout_start_gateway.mjs"
SERVICE=workspace-agent-scout-start-gateway-1
COMMIT=249fe14e85839e4c5bbd32434cac396c85250805
EXPECTED=9dd20d33f28b6cffeddee9b581dd38703044767ee9962ffcf83d27cff695eadc
BACKUP="$ROOT/backups/hermes-scout-item-$(date -u +%Y%m%dT%H%M%SZ)"
test "$(id -u)" = 0 || { echo "Please run as root"; exit 1; }
test -f "$FILE" && test ! -L "$FILE" || { echo "Scout source missing"; exit 1; }
cd "$WORK"
test "$(git rev-parse --is-inside-work-tree)" = true
git remote get-url origin | grep -Eq 'harpertristan/test(\\.git)?$'
git cat-file -e "$COMMIT^{commit}" || { echo "Fetch release branch first"; exit 1; }
ACTUAL=$(sha256sum "$FILE" | awk '{print $1}')
if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "Server Scout code differs from audited source. Nothing modified."
  echo "Actual SHA256: $ACTUAL"
  exit 2
fi
mkdir -p "$BACKUP"
cp -p "$FILE" "$BACKUP/scout_start_gateway.mjs"
STAGE=$(mktemp "$WORK/agent-stack/.scout-release.XXXXXX.mjs")
trap 'rm -f "$STAGE"' EXIT
git show "$COMMIT:agent-stack/scout_start_gateway.mjs" > "$STAGE"
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  -v "$STAGE:/tmp/scout_start_gateway.mjs:ro" \
  --entrypoint node workspace-paperclip:7e3caa7 --check /tmp/scout_start_gateway.mjs
chmod --reference="$FILE" "$STAGE"
chown --reference="$FILE" "$STAGE"
mv -f "$STAGE" "$FILE"
restore() {
 echo "Health check failed; restoring original Scout gateway"
 cp -p "$BACKUP/scout_start_gateway.mjs" "$FILE"
 docker restart "$SERVICE" >/dev/null || true
}
trap restore ERR
docker restart "$SERVICE" >/dev/null
HEALTH=""
for _ in $(seq 1 36); do
  HEALTH=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$SERVICE")
  [ "$HEALTH" = healthy ] && break
  sleep 5
done
[ "$HEALTH" = healthy ] || { echo "Scout gateway unhealthy: $HEALTH"; false; }
trap - ERR
echo "SCOUT ITEM FALLBACK INSTALLED AND HEALTHY"
echo "Backup: $BACKUP"
echo "Use exact reviewId; no permissions, messages, or CRM statuses changed."
