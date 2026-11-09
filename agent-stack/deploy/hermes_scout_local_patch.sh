#!/usr/bin/env bash
# Safe local patch: keep all current Scout gateway edits and insert only an exact-ID
# fallback for 404 /api/crm/item requests. Never modifies CRM records.
set -Eeuo pipefail
umask 077
ROOT=/srv/hermes-stack
BASE="$ROOT/deployment-source/agent-stack"
FILE="$BASE/scout_start_gateway.mjs"
SERVICE=workspace-agent-scout-start-gateway-1
BACKUP="$ROOT/backups/hermes-scout-item-local-$(date -u +%Y%m%dT%H%M%SZ)"
test "$(id -u)" -eq 0 || { echo "Run with sudo"; exit 1; }
test -f "$FILE" && test ! -L "$FILE" || { echo "Source missing or symlinked"; exit 1; }
docker inspect "$SERVICE" >/dev/null
mkdir -p "$BACKUP"
cp -p "$FILE" "$BACKUP/scout_start_gateway.mjs"
echo "BACKUP: $BACKUP"
STAGE="$(mktemp "$BASE/.scout-404-fallback.XXXXXX.mjs")"
CHANGED=0
cleanup() { rm -f "$STAGE"; }
restore() {
  code=$?
  if [ "$CHANGED" -eq 1 ]; then
    echo "Deployment failed; restoring previous gateway source."
    cp -p "$BACKUP/scout_start_gateway.mjs" "$FILE" || true
    docker restart "$SERVICE" >/dev/null || true
  fi
  cleanup
  exit "$code"
}
trap restore ERR
trap cleanup EXIT

python3 - "$FILE" "$STAGE" <<'PY'
from pathlib import Path
import sys
src = Path(sys.argv[1]).read_text(encoding="utf-8")
dst = Path(sys.argv[2])
marker = "HERMES_SCOUT_EXACT_ID_FALLBACK_V1"
if marker in src:
    print("Fallback already present; do not install twice.")
    raise SystemExit(3)
anchor = '      if(result.status!==200)return reply(res,502,{code:"SCOUT_READ_UNAVAILABLE"});'
if src.count(anchor) != 1:
    raise SystemExit("SAFE STOP: local handler differs. Existing code unchanged.")
pos = src.index(anchor)
before = src[max(0,pos-2000):pos]
if 'payload.operation==="scout_review_item"' not in before or 'const result=await request(' not in before:
    raise SystemExit("SAFE STOP: cannot verify read-only Scout item handler.")
insertion = """      // HERMES_SCOUT_EXACT_ID_FALLBACK_V1
      // Only a missing optional detail endpoint (HTTP 404) uses a CRM snapshot.
      // A 401/403 or upstream connection failure is never bypassed.
      if(payload.operation==="scout_review_item" && result.status===404){
        const snapshot=await request({hostname:SCOUT,port:SCOUT_PORT,
          path:"/api/crm",method:"GET"},null,24*1024*1024,25000);
        if(snapshot.status!==200)
          return reply(res,502,{code:"SCOUT_SNAPSHOT_UNAVAILABLE",upstreamStatus:snapshot.status});
        let parsed;
        try{parsed=parseJSON(snapshot);}
        catch{return reply(res,502,{code:"SCOUT_SNAPSHOT_INVALID"});}
        if(!Array.isArray(parsed?.rows))
          return reply(res,502,{code:"SCOUT_SNAPSHOT_INVALID"});
        const id=payload.params?.reviewId;
        const row=parsed.rows.find(item=>item&&typeof item==="object"&&item.id===id);
        if(!row)return reply(res,404,{code:"CRM_ITEM_NOT_FOUND"});
        let projected;
        try{projected=reviewItem(row,{detail:true});}
        catch{return reply(res,502,{code:"CRM_ITEM_INVALID"});}
        rememberLinks(task.id,[projected.website,
          ...projected.evidence.map(e=>e.source)].filter(Boolean));
        return reply(res,200,{operation:payload.operation,data:projected});
      }
"""
dst.write_text(src.replace(anchor, insertion+anchor, 1), encoding="utf-8")
print("PATCH PREPARED: read-only item 404 fallback")
PY

# Validate candidate without installing host Node.js or modifying a running container.
docker run --rm --user 0:0 --network none --read-only \
  --cap-drop ALL --security-opt no-new-privileges \
  -v "$STAGE:/tmp/scout_gateway.mjs:ro" \
  --entrypoint node workspace-paperclip:7e3caa7 \
  --check /tmp/scout_gateway.mjs
# Preserve permissions and owner of existing source; swap only once checks passed.
chown --reference="$FILE" "$STAGE"
chmod --reference="$FILE" "$STAGE"
mv -f "$STAGE" "$FILE"
CHANGED=1
docker restart "$SERVICE" >/dev/null
HEALTH=starting
for _ in $(seq 1 36); do
  HEALTH="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$SERVICE")"
  [ "$HEALTH" = healthy ] && break
  sleep 5
done
if [ "$HEALTH" != healthy ]; then
  echo "Gateway health failure: $HEALTH"
  false
fi
CHANGED=0
trap - ERR
echo "PATCH INSTALLED AND SCOUT GATEWAY HEALTHY"
echo "No CRM record changes; previous source saved: $BACKUP"
