#!/usr/bin/env bash
# One-command, fail-closed Hermes -> Scout install. No automatic research job.
set -Eeuo pipefail
umask 077
ROOT=/srv/hermes-stack
REPO="$ROOT/deployment-source"
BASE="$REPO/agent-stack"
ISSUE_ID=2d95562b-a3f8-465e-bfa9-842dbd950acb
ISSUE_KEY=WOR-7
SCOPE="$ROOT/private/three-tool-scope.json"
CONF="$ROOT/config/hermes-gateway.yaml"
STATE="$ROOT/state/scout-start"
BRANCH=test-hermes-scout-flow-20261108
COMPOSE=(docker compose -f "$BASE/compose.yaml" -f "$BASE/compose.paperclip.yaml"
 -f "$BASE/compose.hermes-gateway.yaml" -f "$BASE/compose.task-control.yaml"
 -f "$BASE/compose.three-tools.yaml" -f "$BASE/compose.scout-start.yaml")
FILES=(task_runtime_context.py task_control_mcp.py serve_hermes.py
 hermes_gateway_bridge.py scout_start_policy.mjs scout_start_gateway.mjs
 compose.scout-start.yaml)
[[ ${EUID} -eq 0 ]] || { echo "Run with sudo" >&2; exit 2; }
for cmd in docker git python3 tar install cmp; do command -v "$cmd" >/dev/null || exit 2; done
[[ -f "$SCOPE" && -f "$CONF" && -d "$REPO/.git" ]] || { echo "Unexpected layout; no changes" >&2; exit 2; }
for c in workspace-agent-hermes-runtime-1 workspace-agent-task-control-1 workspace-agent-three-tool-read-1 play-scout-app-1; do
 docker inspect "$c" >/dev/null
done
TMP="$(mktemp -d /tmp/hermes-scout-install.XXXXXXXX)"
BACKUP=""
APPLIED=0
NEW_SERVICE=0
cleanup(){ rm -rf "$TMP"; }
rollback(){
 if [[ "$APPLIED" != 1 ]];then return;fi
 echo "=== RESTORING BACKUP $BACKUP ===" >&2
 for f in "${FILES[@]}"; do
  if [[ -f "$BACKUP/$f" ]];then install -m 0644 "$BACKUP/$f" "$BASE/$f"
  else rm -f "$BASE/$f";fi
 done
 # Keep the inode of bind-mounted scope/config to avoid stale secrets.
 cat "$BACKUP/scope.json" > "$SCOPE"
 cat "$BACKUP/config.yaml" > "$CONF"
 chown 10000:10000 "$SCOPE" || true
 chmod 0400 "$SCOPE"
 chmod 0444 "$CONF"
 if [[ "$NEW_SERVICE" == 1 ]];then
  "${COMPOSE[@]}" stop scout-start-gateway >/dev/null 2>&1 || true
  "${COMPOSE[@]}" rm -sf scout-start-gateway >/dev/null 2>&1 || true
 fi
 "${COMPOSE[@]:0:11}" up -d --no-deps --force-recreate hermes-runtime hermes-paperclip-bridge >/dev/null 2>&1 || true
}
fail(){ local ec="$?";trap - ERR;rollback;echo "FAILED ($ec). Backup: ${BACKUP:-none}. Nothing deleted." >&2;exit "$ec"; }
trap fail ERR
trap cleanup EXIT
echo "=== FETCHED CODE REF ==="
# Caller fetched branch before sudo. Don't merge or alter the user's Git checkout.
REF="$(git -c safe.directory="$REPO" -C "$REPO" rev-parse FETCH_HEAD)"
git -c safe.directory="$REPO" -C "$REPO" archive "$REF" agent-stack | tar -x -C "$TMP"
for f in "${FILES[@]}";do test -s "$TMP/agent-stack/$f";done
echo "Commit $REF"
echo "=== STATIC CONTRACT TESTS ==="
export PYTHONDONTWRITEBYTECODE=1
(cd "$TMP/agent-stack" && python3 -m unittest discover -s tests -p 'test_*mcp_contract.py' -v)
(cd "$TMP/agent-stack" && python3 -m unittest discover -s tests -p test_task_read_gate.py -v)
node_runner=( )
if docker image inspect workspace-paperclip:7e3caa7 >/dev/null 2>&1;then
 docker run --rm --network none --read-only -v "$TMP/agent-stack:/work:ro" -w /work \
  --entrypoint node workspace-paperclip:7e3caa7 --test \
  tests/task_control_policy.test.mjs tests/three_tool_read_scope.test.mjs \
  tests/hermes_scout_contract.test.mjs tests/scout_start_policy.test.mjs
elif command -v node >/dev/null;then
 (cd "$TMP/agent-stack" && node --test tests/task_control_policy.test.mjs \
  tests/three_tool_read_scope.test.mjs tests/hermes_scout_contract.test.mjs \
  tests/scout_start_policy.test.mjs)
else echo "Node unavailable; deployment blocked" >&2;exit 2;fi
python3 -m py_compile "$TMP/agent-stack/"{task_control_mcp.py,task_runtime_context.py,serve_hermes.py,hermes_gateway_bridge.py}
echo "=== DISCOVER ALLOWLIST (NO SCOUT MUTATION) ==="
docker exec play-scout-app-1 node --input-type=module -e '
import {SEARCH_CHANNELS} from "/app/lib/source-workspace-catalog.js";
const ids=SEARCH_CHANNELS.filter(x=>x.kind==="web" && typeof x.id==="string").map(x=>x.id);
console.log(JSON.stringify(ids));
' > "$TMP/web-sources.json"
python3 - "$TMP/web-sources.json" "$SCOPE" "$CONF" "$TMP" "$ISSUE_ID" "$ISSUE_KEY" <<'PY'
import json,re,sys,pathlib
ids=json.loads(pathlib.Path(sys.argv[1]).read_text())
scope=json.loads(pathlib.Path(sys.argv[2]).read_text())
config=pathlib.Path(sys.argv[3]).read_text()
root=pathlib.Path(sys.argv[4]);issue_id=sys.argv[5];issue_key=sys.argv[6]
safe=[s for s in ids if re.fullmatch(r"[a-z0-9:_./-]{1,120}",s)]
if len(safe)<1:raise SystemExit("No safe web source IDs. No changes.")
selected=sorted(set(safe))[:2]
if scope.get("version")!=1 or not isinstance(scope.get("grants"),dict):raise SystemExit("Bad scope policy")
grant=scope["grants"].get(issue_id)
if not isinstance(grant,dict) or grant.get("issueIdentifier")!=issue_key or grant.get("workspaceWide") is not True:
 raise SystemExit("WOR-7 grant missing/not workspace-wide; do not expand implicitly")
ops=grant.get("operations")
if not isinstance(ops,list):raise SystemExit("Invalid existing grants")
for op in ("scout_start","scout_findings","scout_candidates","scout_monitor"):
 if op not in ops:ops.append(op)
grant["scoutSourceIds"]=selected
old="include: [current_task, submit_result, scout_read, assistant_read, mail_crm_read]"
new="include: [current_task, submit_result, scout_start, scout_read, assistant_read, mail_crm_read]"
if old not in config and new not in config:raise SystemExit("Unknown Hermes MCP config; no changes.")
config=config.replace(old,new)
(root/"scope.new").write_text(json.dumps(scope,indent=2)+"\n")
(root/"config.new").write_text(config)
print("Selected web sources:",selected)
print("Only WOR-7 authorized; paid sources disabled; no search launched.")
PY

echo "=== BACKUP ==="
BACKUP="$ROOT/backups/hermes-scout-start-$(date -u +%Y%m%d-%H%M%S)-$$"
mkdir -p "$BACKUP"
for f in "${FILES[@]}";do
 if [[ -f "$BASE/$f" ]];then cp -p "$BASE/$f" "$BACKUP/$f";fi
done
cp -p "$SCOPE" "$BACKUP/scope.json"
cp -p "$CONF" "$BACKUP/config.yaml"
printf 'commit=%s\nissue=%s\n' "$REF" "$ISSUE_ID" > "$BACKUP/manifest.txt"

echo "=== INSTALL SOURCE, SCOPE AND CONFIG ==="
APPLIED=1
for f in "${FILES[@]}";do install -m 0644 "$TMP/agent-stack/$f" "$BASE/$f";done
cat "$TMP/scope.new" > "$SCOPE"
cat "$TMP/config.new" > "$CONF"
chown 10000:10000 "$SCOPE"
chmod 0400 "$SCOPE"
chmod 0444 "$CONF"
mkdir -p "$STATE"
chown 10000:10000 "$STATE"
chmod 0700 "$STATE"

echo "=== COMPOSE VALIDATION ==="
"${COMPOSE[@]}" config -q
echo "=== START RESTRICTED GATEWAY ONLY ==="
"${COMPOSE[@]}" up -d --no-deps --pull never scout-start-gateway
NEW_SERVICE=1
echo "=== RECREATE HERMES ONLY ==="
"${COMPOSE[@]}" up -d --no-deps --pull never --force-recreate hermes-runtime hermes-paperclip-bridge

echo "=== CHECK HEALTH ==="
ready=0
for i in {1..24};do
 status="$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' workspace-agent-hermes-runtime-1)"
 gw="$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' workspace-agent-scout-start-gateway-1)"
 if [[ "$status" == "running healthy" && "$gw" == "running healthy" ]];then ready=1;break;fi
 sleep 5
done
[[ "$ready" == 1 ]] || { echo "Gateway/Hermes not healthy";false; }
for c in workspace-agent-task-control-1 workspace-agent-three-tool-read-1;do
 [[ "$(docker inspect -f '{{.State.Health.Status}}' "$c")" == "healthy" ]] || false
done
[[ "$(docker inspect -f '{{.HostConfig.NetworkMode}}' workspace-agent-hermes-runtime-1)" == "none" ]] || { echo "Hermes network changed unexpectedly";false; }
echo "=== GATEWAY TO SCOUT READ-ONLY PROBE ==="
docker exec workspace-agent-scout-start-gateway-1 node -e '
require("node:http").get("http://play-scout-app-1:3000/api/monitor",r=>{
r.resume();r.on("end",()=>{console.log("Scout HTTP",r.statusCode);if(r.statusCode!==200)process.exitCode=1})
}).on("error",e=>{console.error("Scout not reachable:",e.code);process.exitCode=1})
'
echo "=== MCP REGISTRATION ==="
docker exec -i workspace-agent-hermes-runtime-1 /opt/hermes/.venv/bin/python /opt/workspace-agent/task_control_mcp.py <<'JSON' > "$TMP/mcp.json"
{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
JSON
python3 - "$TMP/mcp.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
names={x["name"] for x in r["result"]["tools"]}
assert names=={"current_task","submit_result","scout_start","scout_read","assistant_read","mail_crm_read"},names
print("MCP verified:",", ".join(sorted(names)))
PY
echo "=== FINISHED ==="
echo "SUCCESS: Scout start gateway installed, approved web source scope added to WOR-7."
echo "BACKUP: $BACKUP"
echo "No search started. WOR-7 must be in_progress with a live matching Hermes run."
