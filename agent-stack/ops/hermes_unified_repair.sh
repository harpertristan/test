#!/usr/bin/env bash
# Single safe repair: task binding, read bridge, one-agent grants. Never send email.
set -Eeuo pipefail
umask 077
ROOT=/srv/hermes-stack
REPO=$ROOT/deployment-source
BASE=$REPO/agent-stack
SCOPE=$ROOT/private/three-tool-scope.json
IDENTITY=$ROOT/private/task-control.json
CONTROL=workspace-agent-task-control-1
READ=workspace-agent-three-tool-read-1
RUN=workspace-agent-hermes-runtime-1
BRIDGE=workspace-agent-hermes-paperclip-bridge-1
START=workspace-agent-scout-start-gateway-1
FILES="task_control_policy.mjs task_control.mjs three_tool_read_scope.mjs three_tool_read_sidecar.mjs task_control_mcp.py"
test "$EUID" -eq 0 || { echo "sudo is required";exit 2; }
for cmd in git docker python3 tar mktemp install;do command -v "$cmd" >/dev/null;done
test -d "$REPO/.git" && test -s "$SCOPE" && test -s "$IDENTITY"
for c in "$CONTROL" "$READ" "$RUN" "$BRIDGE" "$START";do docker inspect "$c" >/dev/null;done
WORK=$(mktemp -d /tmp/hermes-unified.XXXXXXXX)
BACKUP=
CHANGED=0
cleanup(){ rm -rf "$WORK"; }
rollback(){
 if [ "$CHANGED" = 1 ] && [ -n "$BACKUP" ];then
  echo "ROLLBACK to $BACKUP" >&2
  for f in $FILES;do install -m 0644 "$BACKUP/$f" "$BASE/$f" || true;done
  cat "$BACKUP/scope.json" > "$SCOPE" || true
  chown 10000:10000 "$SCOPE" || true
  chmod 0400 "$SCOPE" || true
  docker restart "$CONTROL" "$READ" "$RUN" "$BRIDGE" >/dev/null 2>&1 || true
 fi
}
failure(){ code=$?; trap - ERR; rollback;echo "FAILED ($code), backup $BACKUP" >&2;exit "$code"; }
trap failure ERR
trap cleanup EXIT
REF=$(git -c safe.directory="$REPO" -C "$REPO" rev-parse FETCH_HEAD)
echo "=== VERIFY $REF BEFORE MODIFYING PRODUCTION ==="
git -c safe.directory="$REPO" -C "$REPO" archive "$REF" agent-stack | tar -x -C "$WORK"
for f in $FILES;do test -s "$WORK/agent-stack/$f";done
python3 -m py_compile "$WORK/agent-stack/task_control_mcp.py" "$WORK/agent-stack/task_runtime_context.py" "$WORK/agent-stack/serve_hermes.py" "$WORK/agent-stack/hermes_gateway_bridge.py"
(cd "$WORK/agent-stack" && PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p test_scoped_mcp_contract.py -v)
(cd "$WORK/agent-stack" && PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p test_task_read_gate.py -v)
if docker image inspect workspace-paperclip:7e3caa7 >/dev/null 2>&1;then
 docker run --rm --network none --read-only --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m \
 -v "$WORK/agent-stack:/work:ro" -w /work --entrypoint node workspace-paperclip:7e3caa7 \
 --test tests/task_control_policy.test.mjs tests/three_tool_read_scope.test.mjs \
 tests/three_tool_read_sidecar.integration.test.mjs tests/hermes_scout_contract.test.mjs tests/scout_start_policy.test.mjs
else
 (cd "$WORK/agent-stack" && node --test tests/task_control_policy.test.mjs tests/three_tool_read_scope.test.mjs tests/three_tool_read_sidecar.integration.test.mjs tests/hermes_scout_contract.test.mjs tests/scout_start_policy.test.mjs)
fi
echo "=== PREPARE EXPLICIT SINGLE-AGENT READ SCOPE ==="
python3 - "$SCOPE" "$IDENTITY" "$WORK/scope.json" <<'PY'
import json,sys
scope,identity,out=sys.argv[1:]
s=json.load(open(scope));i=json.load(open(identity))
agent=i.get("agentId");company=i.get("companyId")
assert s.get("version")==1 and isinstance(s.get("grants"),dict)
assert isinstance(agent,str) and agent and isinstance(company,str) and company
d=s.setdefault("agentGrants",{})
assert isinstance(d,dict)
existing=d.get(agent)
assert existing is None or (existing.get("agentId")==agent and existing.get("companyId")==company)
d[agent]={"agentId":agent,"companyId":company,
 "operations":["scout_candidates","scout_findings","scout_monitor","scout_active",
               "assistant_companies","mail_companies","mail_tasks","mail_messages","mail_message"],
 "workspaceWide":True,"mailConsent":True,"companyIds":[]}
with open(out,"w") as f:json.dump(s,f,ensure_ascii=False,indent=2);f.write("\n")
print("Agent-wide read-only access prepared. No SMTP, delete, secret, URL, host-shell tools.")
PY
echo "=== BACKUP ==="
BACKUP=$ROOT/backups/hermes-unified-$(date -u +%Y%m%d-%H%M%S)-$$
mkdir -p "$BACKUP"
for f in $FILES;do cp -p "$BASE/$f" "$BACKUP/$f";done
cp -p "$SCOPE" "$BACKUP/scope.json"
echo "$REF" > "$BACKUP/commit.txt"
echo "=== APPLY ==="
CHANGED=1
for f in $FILES;do install -m 0644 "$WORK/agent-stack/$f" "$BASE/$f";done
# Existing Docker file bind mounts demand modifying the same inode.
cat "$WORK/scope.json" > "$SCOPE"
chown 10000:10000 "$SCOPE"
chmod 0400 "$SCOPE"
echo "=== RESTART ONLY AFFECTED SERVICES ==="
docker restart "$CONTROL" "$READ" "$RUN" "$BRIDGE" >/dev/null
echo "=== HEALTH ==="
ready=0
for j in $(seq 1 36);do
 good=1
 for c in "$CONTROL" "$READ" "$RUN";do
  state=$(docker inspect -f '{{.State.Status}}:{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$c")
  [ "$state" = running:healthy ] || good=0
 done
 [ "$(docker inspect -f '{{.State.Status}}' "$BRIDGE")" = running ] || good=0
 if [ "$good" = 1 ];then ready=1;break;fi
 sleep 5
done
[ "$ready" = 1 ]
[ "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$RUN")" = none ]
echo "=== VERIFY INVALID TASK CAPABILITY IS DENIED ==="
docker exec "$READ" node -e '
const http=require("node:http"),d=JSON.stringify({capability:"invalid",operation:"scout_findings",params:{}});
const r=http.request({socketPath:"/run/three-tools/read.sock",path:"/read",method:"POST",
headers:{"content-type":"application/json","content-length":Buffer.byteLength(d)}},x=>{
x.resume();x.on("end",()=>{console.log("invalid-read-status="+x.statusCode);if(x.statusCode!==403)process.exitCode=1});
});r.on("error",()=>process.exitCode=1);r.end(d);
'
echo "=== VERIFY SIX MCP TOOLS AND ONE-AGENT SCOPE ==="
docker exec -i "$RUN" /opt/hermes/.venv/bin/python /opt/workspace-agent/task_control_mcp.py <<'JSON' > "$WORK/mcp.json"
{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
JSON
python3 - "$WORK/mcp.json" "$SCOPE" "$IDENTITY" <<'PY'
import json,sys
m=json.load(open(sys.argv[1]))
assert {x["name"] for x in m["result"]["tools"]}=={
 "current_task","submit_result","scout_start","scout_read","assistant_read","mail_crm_read"}
s=json.load(open(sys.argv[2]));i=json.load(open(sys.argv[3]))
g=s["agentGrants"][i["agentId"]]
assert g["companyId"]==i["companyId"]
assert "mail_message" in g["operations"] and "mail_send" not in g["operations"]
assert "assistant_profile" not in g["operations"]
print("MCP tools and scoped access: PASS")
PY
CHANGED=0
echo "=== SUCCESS: UNIFIED HERMES RUN AND READ PERMISSION REPAIR ==="
echo "BACKUP: $BACKUP"
echo "No Paperclip status/run locks changed. No mail sent. One-time live task test still required."
