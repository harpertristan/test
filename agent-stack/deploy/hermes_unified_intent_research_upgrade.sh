#!/usr/bin/env bash
# Hermes unified intent + Scout public research repair.
# Patches only reviewed, recognizable code paths; never enables writes or model root.
set -Eeuo pipefail
umask 077
ROOT=/srv/hermes-stack
WORK="$ROOT/deployment-source"
BASE="$WORK/agent-stack"
GATE="$BASE/scout_start_gateway.mjs"
BRIDGE="$BASE/hermes_gateway_bridge.py"
TRUST="$BASE/scout_crm_source_trust.mjs"
SCOUT_SERVICE=workspace-agent-scout-start-gateway-1
BRIDGE_SERVICE=workspace-agent-hermes-paperclip-bridge-1
RELEASE=d1464fcb1a43158075f165050919904fa6e463a6
BACKUP="$ROOT/backups/hermes-intent-research-$(date -u +%Y%m%dT%H%M%SZ)"
test "$(id -u)" -eq 0 || { echo "ERROR: run with sudo"; exit 1; }
for file in "$GATE" "$BRIDGE"; do
 test -f "$file" && test ! -L "$file" || { echo "ERROR: unsafe source $file"; exit 1; }
done
test ! -e "$TRUST" || { echo "ERROR: helper already exists; inspect before overwriting"; exit 1; }
cd "$WORK"
git remote get-url origin | grep -Eq 'harpertristan/test([.]git)?$' || { echo "ERROR: wrong Git origin"; exit 1; }
git cat-file -e "$RELEASE^{commit}" || { echo "ERROR: fetch release branch first"; exit 1; }
mkdir -p "$BACKUP/stage/tests"
chmod 700 "$BACKUP" "$BACKUP/stage"
STAGE="$BACKUP/stage"
cp -p "$GATE" "$BACKUP/scout_start_gateway.mjs"
cp -p "$BRIDGE" "$BACKUP/hermes_gateway_bridge.py"
cp -p "$GATE" "$STAGE/scout_start_gateway.mjs"
cp -p "$BRIDGE" "$STAGE/hermes_gateway_bridge.py"
git show "$RELEASE:agent-stack/scout_start_gateway.mjs" > "$STAGE/reviewed_gateway.mjs"
git show "$RELEASE:agent-stack/hermes_gateway_bridge.py" > "$STAGE/reviewed_bridge.py"
git show "$RELEASE:agent-stack/scout_crm_source_trust.mjs" > "$STAGE/scout_crm_source_trust.mjs"
git show "$RELEASE:agent-stack/tests/scout_crm_source_trust.test.mjs" > "$STAGE/tests/scout_crm_source_trust.test.mjs"
git show "$RELEASE:agent-stack/tests/scout_web_fetch.test.mjs" > "$STAGE/tests/scout_web_fetch.test.mjs"
cp -p "$BASE/scout_web_policy.mjs" "$STAGE/scout_web_policy.mjs"
cp -p "$BASE/active_run_scope.mjs" "$STAGE/active_run_scope.mjs"
cp -p "$BASE/scout_web_fetch.mjs" "$STAGE/scout_web_fetch.mjs"

python3 - "$STAGE" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
src=(p/"scout_start_gateway.mjs").read_text()
review=(p/"reviewed_gateway.mjs").read_text()
old_import='import {publicOpen,publicSearch} from "./scout_web_fetch.mjs";'
new_import='import {crmContainsPublicSite} from "./scout_crm_source_trust.mjs";'
old='''      if(action.action==="open"&&!trustedResearchUrl(task.id,action.url))
        return reply(res,403,{code:"URL_NOT_DISCOVERED"});'''
marker='''      if(action.action==="open"&&!trustedResearchUrl(task.id,action.url)){'''
end='''      const data=action.action==='''

if src.count(old_import)!=1 or src.count(old)!=1 or review.count(marker)!=1:
 raise SystemExit("SAFE STOP: unrecognized local research handler")
if new_import in src:
 raise SystemExit("SAFE STOP: partial patch already present")
start=review.index(marker)
stop=review.index(end,start)
replacement=review[start:stop].rstrip()
src=src.replace(old_import,old_import+"\n"+new_import,1).replace(old,replacement,1)
(p/"scout_start_gateway.mjs").write_text(src)

bridge=(p/"hermes_gateway_bridge.py").read_text()
review_bridge=(p/"reviewed_bridge.py").read_text()
anchor="CHAT_INSTRUCTIONS = (\n"
marker='    "РЕЖИМ ОСМЫСЛЕННОГО ИСПОЛНЕНИЯ:'
old_start='    "\\nДоверенный режим запуска:'
if bridge.count(anchor)!=1 or review_bridge.count(marker)!=1 or review_bridge.count(old_start)!=1:
 raise SystemExit("SAFE STOP: unrecognized chat instruction source")
start=review_bridge.index(marker)
stop=review_bridge.index(old_start,start)
fragment=review_bridge[start:stop]
if marker in bridge:
 raise SystemExit("SAFE STOP: intent instructions already installed")
bridge=bridge.replace(anchor,anchor+fragment,1)
(p/"hermes_gateway_bridge.py").write_text(bridge)
print("Prepared: CRM URL provenance, exact errors and Russian intent instructions")
PY

# Verify the exact staged source, not just the installation script.
python3 -m py_compile "$STAGE/hermes_gateway_bridge.py"
docker run --rm --network none --read-only --cap-drop ALL \
 --security-opt no-new-privileges -v "$STAGE:/work:ro" \
 --entrypoint node workspace-paperclip:7e3caa7 \
 --check /work/scout_start_gateway.mjs
docker run --rm --network none --read-only --cap-drop ALL \
 --security-opt no-new-privileges -v "$STAGE:/work:ro" \
 --entrypoint node workspace-paperclip:7e3caa7 \
 --test /work/tests/scout_crm_source_trust.test.mjs /work/tests/scout_web_fetch.test.mjs
echo "PREDEPLOY TESTS PASSED"
CHANGED=0
rollback() {
 trap - ERR
 if [ "$CHANGED" -eq 1 ]; then
   echo "ERROR: rolling back Hermes and Scout files"
   cp -p "$BACKUP/scout_start_gateway.mjs" "$GATE" || true
   cp -p "$BACKUP/hermes_gateway_bridge.py" "$BRIDGE" || true
   rm -f "$TRUST"
   docker restart "$SCOUT_SERVICE" "$BRIDGE_SERVICE" >/dev/null || true
 fi
}
trap rollback ERR
CHANGED=1
cp -p "$STAGE/scout_start_gateway.mjs" "$GATE"
cp -p "$STAGE/hermes_gateway_bridge.py" "$BRIDGE"
install -m 0644 -o "$(stat -c %u "$GATE")" -g "$(stat -c %g "$GATE")" \
 "$STAGE/scout_crm_source_trust.mjs" "$TRUST"
docker restart "$SCOUT_SERVICE" "$BRIDGE_SERVICE" >/dev/null
ok=0
for i in $(seq 1 30); do
 health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$SCOUT_SERVICE")
 running=$(docker inspect -f '{{.State.Running}}' "$BRIDGE_SERVICE")
 if [ "$health" = healthy ] && [ "$running" = true ]; then ok=1; break; fi
 sleep 5
done
[ "$ok" -eq 1 ] || { echo "ERROR: services unhealthy"; false; }
CHANGED=0
trap - ERR
echo "HERMES RESEARCH + INTENT UPGRADE INSTALLED"
echo "Scout Gateway: healthy"
echo "Hermes Bridge: running"
echo "Backup: $BACKUP"
echo "No mail sent, no CRM records modified, no production approval bypass"
echo "Live site fetch still depends on remote site availability and public search results."
