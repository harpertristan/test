#!/usr/bin/env bash
# Install only Scout public-search ranking, preserving all local server edits.
set -Eeuo pipefail
umask 077
ROOT=/srv/hermes-stack
BASE="$ROOT/deployment-source/agent-stack"
FILE="$BASE/scout_web_fetch.mjs"
SERVICE=workspace-agent-scout-start-gateway-1
PATCH_COMMIT=1681e4ab38d25858d0bb9f1564e3b3382fe67f3a
BACKUP="$ROOT/backups/hermes-scout-search-$(date -u +%Y%m%dT%H%M%SZ)"
test "$(id -u)" -eq 0 || { echo "Run with sudo"; exit 1; }
test -f "$FILE" && test ! -L "$FILE" || { echo "Scout search source missing"; exit 1; }
cd "$ROOT/deployment-source"
git cat-file -e "$PATCH_COMMIT^{commit}"
mkdir -p "$BACKUP"
cp -p "$FILE" "$BACKUP/scout_web_fetch.mjs"
STAGE=$(mktemp "$BASE/.scout-search.XXXXXX.mjs")
PATCH=$(mktemp)
trap 'rm -f "$STAGE" "$PATCH"' EXIT
git show "$PATCH_COMMIT:agent-stack/scout_web_fetch.mjs" > "$PATCH"
python3 - "$FILE" "$STAGE" "$PATCH" <<'PY'
from pathlib import Path
import sys
source=Path(sys.argv[1]).read_text()
updated=Path(sys.argv[3]).read_text()
mark="export function rankResearchResults(links, query) {"
anchor="export async function publicSearch(query,network){"
if mark in source:
    raise SystemExit("Already installed; no changes made")
if source.count(anchor)!=1 or updated.count(mark)!=1:
    raise SystemExit("Source mismatch; no changes made")
start=updated.index("// Search-engine pages contain navigation")
stop=updated.index(anchor,start)
helper=updated[start:stop]
old="""      const results=result.links.filter(url=>{"""
pos=source.find(old)
if pos<0 or source.count(old)!=1:
    raise SystemExit("Local search handler differs; no changes made")
end=source.find("      if(results.length)",pos)
if end<0 or end-pos>500:
    raise SystemExit("Local result handler differs; no changes made")
source=source[:pos]+"      const results=rankResearchResults(result.links,text);\n"+source[end:]
source=source.replace(anchor,helper+anchor)
Path(sys.argv[2]).write_text(source)
print("PUBLIC SEARCH PATCH PREPARED")
PY
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  -v "$STAGE:/tmp/scout_web_fetch.mjs:ro" --entrypoint node \
  workspace-paperclip:7e3caa7 --check /tmp/scout_web_fetch.mjs
chown --reference="$FILE" "$STAGE"
chmod --reference="$FILE" "$STAGE"
mv "$STAGE" "$FILE"
recover() {
  echo "Health check failed; restoring previous public search code"
  cp -p "$BACKUP/scout_web_fetch.mjs" "$FILE" || true
  docker restart "$SERVICE" >/dev/null || true
}
trap recover ERR
docker restart "$SERVICE" >/dev/null
HEALTH=starting
for _ in $(seq 1 36); do
  HEALTH=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$SERVICE")
  [ "$HEALTH" = healthy ] && break
  sleep 5
done
[ "$HEALTH" = healthy ] || false
trap - ERR
echo "SCOUT PUBLIC SEARCH UPDATED AND GATEWAY HEALTHY"
echo "BACKUP: $BACKUP"
