#!/usr/bin/env bash
# Narrow, idempotent fix to locally installed Scout public search ranking.
set -Eeuo pipefail
umask 077
BASE=/srv/hermes-stack/deployment-source/agent-stack
TARGET="$BASE/scout_web_fetch.mjs"
SERVICE=workspace-agent-scout-start-gateway-1
BACKUP="/srv/hermes-stack/backups/hermes-search-relevance-$(date -u +%Y%m%dT%H%M%SZ)"
test "$(id -u)" -eq 0 || { echo 'sudo required'; exit 1; }
test -f "$TARGET" && test ! -L "$TARGET" || { echo "Unsafe target"; exit 1; }
mkdir -p "$BACKUP"
cp -p "$TARGET" "$BACKUP/scout_web_fetch.mjs"
STAGE=$(mktemp "$BASE/.search-rank.XXXXXX.mjs")
trap 'rm -f "$STAGE"' EXIT
python3 - "$TARGET" "$STAGE" <<'PY'
from pathlib import Path
import sys
src=Path(sys.argv[1]).read_text()
old='  entries.sort((a,b)=>b.score-a.score);\n  return entries.slice(0,20).map(x=>x.url);'
new='  const relevant=entries.filter(x=>x.score>=4);\n  relevant.sort((a,b)=>b.score-a.score);\n  return relevant.slice(0,20).map(x=>x.url);'
if src.count(new)==1:
    print("ALREADY INSTALLED")
    raise SystemExit(3)
if src.count(old)!=1 or src.count('export function rankResearchResults')!=1:
    raise SystemExit("SAFE STOP: unexpected local code; unchanged")
Path(sys.argv[2]).write_text(src.replace(old,new,1))
print("PATCH PREPARED")
PY
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  -v "$STAGE:/tmp/scout_web_fetch.mjs:ro" --entrypoint node workspace-paperclip:7e3caa7 \
  --check /tmp/scout_web_fetch.mjs
chown --reference="$TARGET" "$STAGE"
chmod --reference="$TARGET" "$STAGE"
mv "$STAGE" "$TARGET"
rollback() {
  echo "FAILURE: restoring previous search module"
  cp -p "$BACKUP/scout_web_fetch.mjs" "$TARGET"
  docker restart "$SERVICE" >/dev/null || true
}
trap rollback ERR
docker restart "$SERVICE" >/dev/null
HEALTH=starting
for i in $(seq 1 30); do
  HEALTH=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$SERVICE")
  [ "$HEALTH" = healthy ] && break
  sleep 5
done
[ "$HEALTH" = healthy ] || false
trap - ERR
echo "SEARCH RELEVANCE PATCH INSTALLED, GATEWAY HEALTHY"
echo "BACKUP: $BACKUP"
