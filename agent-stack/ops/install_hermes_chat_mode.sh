#!/usr/bin/env bash
# Fix Paperclip standing Agent Chat without relaxing task-run identity, cross-company
# permissions, outbound email, or execution-recovery safeguards.
# Uses only first-party Paperclip task-controller metadata to classify the run.
set -Eeuo pipefail
umask 077
ROOT=/srv/hermes-stack
REPO=$ROOT/deployment-source
BASE=$REPO/agent-stack
CONTROL=workspace-agent-task-control-1
BRIDGE=workspace-agent-hermes-paperclip-bridge-1
READ=workspace-agent-three-tool-read-1
START=workspace-agent-scout-start-gateway-1
RUNTIME=workspace-agent-hermes-runtime-1
IMAGE=workspace-paperclip:7e3caa7
FILES="task_control.mjs task_control_policy.mjs active_run_scope.mjs hermes_gateway_bridge.py compose.task-control.yaml three_tool_read_sidecar.mjs scout_web_policy.mjs scout_collect_policy.mjs"
compose(){
 docker compose -f "$BASE/compose.yaml" -f "$BASE/compose.paperclip.yaml" \
  -f "$BASE/compose.hermes-gateway.yaml" -f "$BASE/compose.task-control.yaml" \
  -f "$BASE/compose.three-tools.yaml" -f "$BASE/compose.scout-start.yaml" "$@"
}
test "$EUID" = 0 || { echo "SUDO_REQUIRED" >&2; exit 2; }
for exe in docker git python3 tar mktemp install;do command -v "$exe" >/dev/null;done
test -d "$REPO/.git"
for c in "$CONTROL" "$BRIDGE" "$READ" "$START" "$RUNTIME";do
  test "$(docker inspect -f '{{.State.Status}}' "$c")" = running
done
STAGE=$(mktemp -d /tmp/hermes-chat-mode.XXXXXXXX)
chmod 0755 "$STAGE"
BACKUP=
CHANGED=0
cleanup(){ rm -rf "$STAGE"; }
rollback(){
 if [[ $CHANGED != 1 || -z $BACKUP ]];then return;fi
 echo "ROLLBACK_TO=$BACKUP" >&2
 for f in $FILES;do
  if [[ -f "$BACKUP/$f" ]];then cp -p "$BACKUP/$f" "$BASE/$f" || true
  else rm -f "$BASE/$f" || true;fi
 done
 compose up -d --no-deps --pull never --force-recreate hermes-paperclip-bridge >/dev/null 2>&1 || true
 docker restart "$CONTROL" "$READ" "$START" >/dev/null 2>&1 || true
}
failed(){
 status=$?
 trap - ERR
 rollback
 echo "CHAT_FIX_FAILED=$status; BACKUP=$BACKUP" >&2
 exit "$status"
}
trap failed ERR
trap cleanup EXIT

REF=$(git -c safe.directory="$REPO" -C "$REPO" rev-parse FETCH_HEAD)
echo "=== VERIFY FETCHED RELEASE ==="
echo "COMMIT=$REF"
git -c safe.directory="$REPO" -C "$REPO" archive "$REF" agent-stack | tar -x -C "$STAGE"
chmod 0755 "$STAGE/agent-stack"
for f in $FILES;do test -s "$STAGE/agent-stack/$f";done
echo "=== TEST ACTUAL BRIDGE / NATIVE CHAT CONTEXT AND SECURITY ==="
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --user 10000:10000 \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m \
  -v "$STAGE/agent-stack:/work:ro" -w /work --entrypoint node "$IMAGE" \
  --test tests/task_control_policy.test.mjs tests/active_run_scope.test.mjs \
  tests/three_tool_read_sidecar.integration.test.mjs \
  tests/scout_web_policy.test.mjs tests/scout_collect_policy.test.mjs
PYTHONDONTWRITEBYTECODE=1 python3 -m py_compile \
  "$STAGE/agent-stack/hermes_gateway_bridge.py"
(cd "$STAGE/agent-stack" && PYTHONDONTWRITEBYTECODE=1 \
  python3 -m unittest discover -s tests -p test_hermes_gateway.py -v)

echo "=== VERIFY CURRENT COMPOSE AND KEY/SOCKET WITHOUT REVEALING SECRETS ==="
compose config -q
test -S "$ROOT/task-control/control.sock"
docker exec "$CONTROL" node -e '
const http=require("node:http");
const req=http.get({socketPath:"/run/task-control/control.sock",
  path:"/health",timeout:5000},r=>{
 r.resume();r.on("end",()=>{
   console.log("TASK_CONTROLLER_HEALTH_HTTP="+r.statusCode);
   if(r.statusCode!==200)process.exitCode=1;
 });
});
req.on("error",()=>process.exitCode=2);
'
echo "=== BACKUP CURRENT SOURCE AND COMPOSE ==="
BACKUP="$ROOT/backups/hermes-chat-mode-$(date -u +%Y%m%d-%H%M%S)-$$"
mkdir -p "$BACKUP"
for f in $FILES;do
 if [[ -f "$BASE/$f" ]];then cp -p "$BASE/$f" "$BACKUP/$f";fi
done
printf 'commit=%s\n' "$REF" > "$BACKUP/manifest.txt"
echo "BACKUP=$BACKUP"
CHANGED=1
echo "=== APPLY ONLY CHAT MODE AND SIGNED READ CONTEXT FILES ==="
for f in $FILES;do install -m 0644 "$STAGE/agent-stack/$f" "$BASE/$f";done
echo "=== VERIFY NEW BRIDGE MOUNT CONFIG ==="
compose config -q
echo "=== RESTART TRUSTED CONTROLLER AND SCOPED READ GATEWAYS ==="
docker restart "$CONTROL" "$READ" "$START" >/dev/null
echo "=== RECREATE ONLY PAPERCLIP BRIDGE FOR THE READ-ONLY CONTROL SOCKET ==="
compose up -d --no-deps --pull never --force-recreate hermes-paperclip-bridge
echo "=== VERIFY ALL AFFECTED SERVICES ==="
ready=0
for attempt in $(seq 1 35);do
 good=1
 for c in "$CONTROL" "$READ" "$START" "$RUNTIME";do
  status=$(docker inspect -f '{{.State.Status}}:{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$c")
  [[ "$status" = running:healthy ]] || good=0
 done
 [[ "$(docker inspect -f '{{.State.Status}}' "$BRIDGE")" = running ]] || good=0
 if [[ "$good" = 1 ]];then ready=1;break;fi
 sleep 3
done
test "$ready" = 1
test "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$RUNTIME")" = none
echo "=== VERIFY LIVE BRIDGE CAN REACH CONTROLLER VIA UNIX SOCKET ==="
docker exec "$BRIDGE" /opt/hermes/.venv/bin/python -c '
import os,socket,http.client,json
path="/run/task-control/control.sock"
assert os.path.exists(path)
class Control(http.client.HTTPConnection):
 def connect(self):
  self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
  self.sock.settimeout(4)
  self.sock.connect(path)
conn=Control("control",timeout=4)
try:
 conn.request("POST","/context",json.dumps({"capability":"synthetic-invalid-grant"}),
  {"Content-Type":"application/json"})
 resp=conn.getresponse()
 resp.read()
 print("INVALID_CHAT_CONTEXT_HTTP="+str(resp.status))
 assert resp.status==403
finally:conn.close()
'
echo "=== VERIFY INSTALLED BRIDGE SELECTS CHAT MODE AND KEEP 12 MCP TOOLS ==="
docker exec --workdir /opt/workspace-agent "$BRIDGE" /opt/hermes/.venv/bin/python -c '
from hermes_gateway_bridge import CHAT_INSTRUCTIONS,build_chat_instructions
text=build_chat_instructions("","synthetic-test")
assert "не вызывай begin_task или submit_result" in text
assert "[[workspace-task-grant:synthetic-test]]" in text
print("CHAT_MODE_PROMPT=PASS")
'
docker exec -i "$RUNTIME" /opt/hermes/.venv/bin/python /opt/workspace-agent/task_control_mcp.py <<'JSON' > "$STAGE/mcp.json"
{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
JSON
python3 - "$STAGE/mcp.json" <<'PY'
import json,sys
names={x["name"] for x in json.load(open(sys.argv[1]))["result"]["tools"]}
expected={"current_task","begin_task","submit_result","request_approval",
 "web_research","scout_start","scout_collect","scout_read","assistant_read",
 "mail_crm_read","skills_memory","developer_status"}
assert names==expected,(names,expected)
print("HERMES_MCP_TOOLS=12")
PY

CHANGED=0
echo "=== SUCCESS: PAPERCLIP AGENT CHAT IS NOW DIFFERENT FROM WORK TASKS ==="
echo "No chat/task rows, locks, messages, permissions, emails or secrets changed."
echo "Chat replies no longer require task checkout or submit_result."
echo "BACKUP=$BACKUP"
