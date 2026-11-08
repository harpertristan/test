#!/usr/bin/env bash
# Targeted mail API routing repair. Existing permissions, tasks and CRM records unchanged.
set -Eeuo pipefail
umask 077
ROOT=/srv/hermes-stack
REPO=$ROOT/deployment-source
BASE=$REPO/agent-stack
READ=workspace-agent-three-tool-read-1
BRIDGE=workspace-agent-hermes-paperclip-bridge-1
RUN=workspace-agent-hermes-runtime-1
IMAGE=workspace-paperclip:7e3caa7
FILES="three_tool_read_sidecar.mjs hermes_gateway_bridge.py"
test "$EUID" -eq 0 || { echo "sudo required" >&2;exit 2; }
for exe in docker git python3 tar mktemp;do command -v "$exe" >/dev/null;done
test -d "$REPO/.git"
for c in "$READ" "$BRIDGE" "$RUN";do
 test "$(docker inspect -f '{{.State.Status}}' "$c")" = running
done
STAGE=$(mktemp -d /tmp/hermes-mailfix.XXXXXXXX)
chmod 0755 "$STAGE"
BACKUP=
MUTATED=0
cleanup(){ rm -rf "$STAGE"; }
rollback(){
 if [ "$MUTATED" != 1 ];then return;fi
 echo "ROLLBACK: $BACKUP" >&2
 for f in $FILES;do cp -p "$BACKUP/$f" "$BASE/$f" || true;done
 docker restart "$READ" "$BRIDGE" >/dev/null 2>&1 || true
}
failure(){
 status=$?
 trap - ERR
 rollback
 echo "MAIL_FIX_FAILED=$status; BACKUP=$BACKUP" >&2
 exit "$status"
}
trap failure ERR
trap cleanup EXIT

REF=$(git -c safe.directory="$REPO" -C "$REPO" rev-parse FETCH_HEAD)
echo "=== VERIFY SOURCE COMMIT ==="
echo "COMMIT=$REF"
git -c safe.directory="$REPO" -C "$REPO" archive "$REF" agent-stack | tar -x -C "$STAGE"
chmod 0755 "$STAGE/agent-stack"
for f in $FILES;do test -s "$STAGE/agent-stack/$f" && test -s "$BASE/$f";done
echo "=== TEST UNIX SIDECAR REAL ROUTING CONTRACT ==="
docker run --rm --network none --read-only --cap-drop ALL \
 --security-opt no-new-privileges --user 10000:10000 \
 --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m \
 -v "$STAGE/agent-stack:/work:ro" -w /work --entrypoint node "$IMAGE" \
 --test tests/three_tool_read_sidecar.integration.test.mjs \
 tests/three_tool_read_policy.test.mjs tests/three_tool_read_scope.test.mjs
python3 -m py_compile "$STAGE/agent-stack/hermes_gateway_bridge.py"

echo "=== REAL MAIL CRM API: HTTP 200 AND JSON SCHEMA ==="
docker exec "$READ" node -e '
const http=require("node:http");
const endpoints=[
 {path:"/mail-crm/api/messages",type:"messages"},
 {path:"/mail-crm/api/companies",type:"companies"},
 {path:"/mail-crm/api/tasks",type:"tasks"},
 {path:"/mail-crm/api/accounts",type:"accounts"},
 {path:"/mail-crm/api/notifications",type:"notifications"}
];
async function get(path){
 return new Promise((resolve,reject)=>{
  const req=http.get({hostname:"multi-mail-crm-tool-gateway-1",port:3200,
   path,timeout:12000,headers:{accept:"application/json"}},r=>{
    let size=0;const parts=[];
    r.on("data",b=>{
      size+=b.length;
      if(size>4*1024*1024){r.destroy(new Error("MAIL_JSON_TOO_LARGE"));return;}
      parts.push(b);
    });
    r.on("error",reject);
    r.on("end",()=>{
      const type=String(r.headers["content-type"]||"").toLowerCase();
      let json=null;
      if(type.includes("application/json")){
       try{json=JSON.parse(Buffer.concat(parts).toString("utf8"))}catch{}
      }
      resolve({status:r.statusCode,type,json});
    });
  });
  req.on("timeout",()=>req.destroy(new Error("MAIL_API_TIMEOUT")));
  req.on("error",reject);
 });
}
(async()=>{
 for(const ep of endpoints){
  const r=await get(ep.path);
  const valid=r.status===200&&r.type.includes("application/json")&&
    (ep.type==="messages"?Array.isArray(r.json?.items):
     ep.type==="notifications"?Array.isArray(r.json?.items):
     Array.isArray(r.json));
  const count=Array.isArray(r.json?.items)?r.json.items.length:
    Array.isArray(r.json)?r.json.length:null;
  console.log("MAIL_"+ep.type.toUpperCase()+"_JSON="+
     (valid?"PASS":"FAIL")+(count===null?"":" COUNT="+count));
  if(!valid)process.exitCode=3;
 }
})().catch(e=>{console.error("LIVE_MAIL_PROBE_FAILED="+e.message);process.exitCode=4;});
'

echo "=== BACKUP BEFORE MUTATION ==="
BACKUP="$ROOT/backups/hermes-mail-api-$(date -u +%Y%m%d-%H%M%S)-$$"
mkdir -p "$BACKUP"
for f in $FILES;do cp -p "$BASE/$f" "$BACKUP/$f";done
printf 'commit=%s\n' "$REF" > "$BACKUP/manifest.txt"
MUTATED=1
for f in $FILES;do install -m 0644 "$STAGE/agent-stack/$f" "$BASE/$f";done

echo "=== RESTART ONLY READ SIDECAR AND HERMES MESSAGE ADAPTER ==="
docker restart "$READ" "$BRIDGE" >/dev/null
ready=0
for attempt in $(seq 1 25);do
 state=$(docker inspect -f '{{.State.Status}}:{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$READ")
 bridge=$(docker inspect -f '{{.State.Status}}' "$BRIDGE")
 if [ "$state" = running:healthy ] && [ "$bridge" = running ];then ready=1;break;fi
 sleep 3
done
test "$ready" = 1

echo "=== VERIFY RUNNING ROUTE AND INVALID CAPABILITY DENIAL ==="
docker exec "$READ" node -e '
const http=require("node:http"),fs=require("node:fs");
const code=fs.readFileSync("/opt/workspace-agent/three_tool_read_sidecar.mjs","utf8");
if(!code.includes("mail:\"/mail-crm/api\""))process.exit(3);
const body=JSON.stringify({capability:"invalid-test-token",
 operation:"mail_messages",params:{}});
const req=http.request({socketPath:"/run/three-tools/read.sock",
 method:"POST",path:"/read",headers:{"content-type":"application/json",
 "content-length":Buffer.byteLength(body)}},r=>{
 r.resume();r.on("end",()=>{
  console.log("INVALID_MAIL_CAPABILITY_HTTP="+r.statusCode);
  if(r.statusCode!==403)process.exitCode=4;
 });
});
req.on("error",()=>process.exitCode=5);req.end(body);
'

echo "=== VERIFY EXISTING HERMES MCP TOOL REGISTRY ==="
docker exec -i "$RUN" /opt/hermes/.venv/bin/python /opt/workspace-agent/task_control_mcp.py <<'JSON' > "$STAGE/mcp.json"
{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
JSON
python3 - "$STAGE/mcp.json" <<'PY'
import json,sys
names={t["name"] for t in json.load(open(sys.argv[1]))["result"]["tools"]}
expected={"current_task","begin_task","web_research","scout_collect",
 "scout_read","assistant_read","mail_crm_read","submit_result",
 "request_approval","skills_memory","developer_status","scout_start"}
assert names==expected,(names,expected)
print("HERMES_TOOLS_PASS=12")
PY
MUTATED=0
echo "=== SUCCESS: MAIL CRM ROUTING REPAIRED, ALL TOOLS PRESERVED ==="
echo "No email sent. No task lock, task status or CRM record modified."
echo "BACKUP=$BACKUP"
