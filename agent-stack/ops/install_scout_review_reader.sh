#!/usr/bin/env bash
# Add an authenticated, read-only Play Scout CRM review queue to Hermes.
# Existing model, Paperclip tasks, external approvals, email and databases are untouched.
set -Eeuo pipefail
umask 077
ROOT=/srv/hermes-stack
REPO=$ROOT/deployment-source
BASE=$REPO/agent-stack
SCOPE=$ROOT/private/three-tool-scope.json
IDENTITY=$ROOT/private/task-control.json
SCOUT=workspace-agent-scout-start-gateway-1
READ=workspace-agent-three-tool-read-1
BRIDGE=workspace-agent-hermes-paperclip-bridge-1
IMAGE=workspace-paperclip:7e3caa7
FILES="three_tool_read_policy.mjs scout_review_projection.mjs scout_start_gateway.mjs three_tool_read_sidecar.mjs hermes_gateway_bridge.py"
OPS="scout_review_queue scout_review_item"
test "$EUID" -eq 0 || { echo "sudo required" >&2; exit 2; }
for exe in docker python3 git tar mktemp;do command -v "$exe" >/dev/null;done
test -s "$SCOPE" && test -s "$IDENTITY" && test -d "$REPO/.git"
for c in "$SCOUT" "$READ" "$BRIDGE";do
 test "$(docker inspect -f '{{.State.Status}}' "$c")" = running
done
STAGE=$(mktemp -d /tmp/hermes-review.XXXXXXXX)
chmod 0755 "$STAGE"
BACKUP=
APPLIED=0
cleanup(){ rm -rf "$STAGE"; }
rollback(){
 if [ "$APPLIED" = 1 ];then
  echo "ROLLBACK TO $BACKUP" >&2
  for f in $FILES;do
   if [ -f "$BACKUP/files/$f" ];then cp -p "$BACKUP/files/$f" "$BASE/$f" || true
   else rm -f "$BASE/$f" || true;fi
  done
  cp -p "$BACKUP/three-tool-scope.json" "$SCOPE" || true
  docker restart "$SCOUT" "$READ" "$BRIDGE" >/dev/null 2>&1 || true
 fi
}
failed(){
 status=$?
 trap - ERR
 rollback
 echo "REVIEW_INSTALL_FAILED=$status BACKUP=$BACKUP" >&2
 exit "$status"
}
trap failed ERR
trap cleanup EXIT

REF=$(git -c safe.directory="$REPO" -C "$REPO" rev-parse FETCH_HEAD)
echo "=== VERIFY FETCHED COMMIT ==="
echo "COMMIT=$REF"
git -c safe.directory="$REPO" -C "$REPO" archive "$REF" agent-stack | tar -x -C "$STAGE"
chmod 0755 "$STAGE/agent-stack"
for f in $FILES;do test -s "$STAGE/agent-stack/$f";done
echo "=== SYNTAX AND SIGNED SCOPE CONTRACT TESTS ==="
docker run --rm --network none --read-only --cap-drop ALL \
 --security-opt no-new-privileges --user 10000:10000 \
 --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m \
 -v "$STAGE/agent-stack:/work:ro" -w /work --entrypoint node "$IMAGE" \
 --test tests/scout_review_projection.test.mjs tests/three_tool_read_policy.test.mjs \
 tests/three_tool_read_scope.test.mjs tests/scout_gateway.integration.test.mjs \
 tests/three_tool_read_sidecar.integration.test.mjs
python3 -m py_compile "$STAGE/agent-stack/hermes_gateway_bridge.py"

echo "=== VERIFY REAL PLAY SCOUT CRM REVIEW API, BEFORE CHANGES ==="
read -r -d '' PROBE <<'JS' || true
import {reviewQueue} from "./scout_review_projection.mjs";
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),30000);
try{
 const res=await fetch("http://play-scout-app-1:3000/api/crm",
   {signal:controller.signal,headers:{accept:"application/json"}});
 if(!res.ok)throw Error("CRM_API_HTTP_"+res.status);
 const length=Number(res.headers.get("content-length")||0);
 if(length>24*1024*1024)throw Error("CRM_RESPONSE_TOO_LARGE");
 const data=await res.json();
 const queue=reviewQueue(data,30);
 console.log("PLAY_SCOUT_REVIEW_API=200 QUEUE_COUNT="+queue.count+
  " SAMPLE_COUNT="+queue.items.length+" TRUNCATED="+queue.truncated);
 if(typeof queue.count!=="number")process.exit(3);
}finally{clearTimeout(timer);}
JS
docker run --rm --network "container:$SCOUT" --read-only --cap-drop ALL \
 --security-opt no-new-privileges --user 10000:10000 \
 --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m \
 -v "$STAGE/agent-stack:/work:ro" -w /work --entrypoint node "$IMAGE" \
 --input-type=module -e "$PROBE"

echo "=== PREPARE EXPLICIT PER-AGENT READ SCOPE (NO SEND/WRITE) ==="
python3 - "$SCOPE" "$IDENTITY" "$STAGE/next-scope.json" <<'PY'
import json,pathlib,sys
scope,identity,out=map(pathlib.Path,sys.argv[1:])
policy=json.loads(scope.read_text())
agent=json.loads(identity.read_text())
aid,cid=agent.get("agentId"),agent.get("companyId")
assert policy.get("version")==1 and isinstance(policy.get("grants"),dict)
assert isinstance(aid,str) and isinstance(cid,str)
assert isinstance(policy.get("agentGrants"),dict)
default=policy["agentGrants"].get(aid)
assert isinstance(default,dict) and default.get("agentId")==aid
assert default.get("companyId")==cid and default.get("workspaceWide")==True
assert isinstance(default.get("operations"),list)
for op in ("scout_review_queue","scout_review_item"):
 if op not in default["operations"]:default["operations"].append(op)
# Respect specific task grants if present, without changing other task grants.
for item in policy["grants"].values():
 if isinstance(item,dict) and item.get("issueIdentifier")=="WOR-7" and item.get("workspaceWide")==True:
  assert isinstance(item.get("operations"),list)
  for op in ("scout_review_queue","scout_review_item"):
   if op not in item["operations"]:item["operations"].append(op)
assert not set(default["operations"]) & {"mail_send","mail_delete","external_post","scout_review_write"}
out.write_text(json.dumps(policy,ensure_ascii=False,indent=2)+"\n")
print("Verified Hermes agent grant: two new read-only Play Scout CRM operations")
PY

echo "=== BACKUP BEFORE MUTATION ==="
BACKUP="$ROOT/backups/hermes-review-$(date -u +%Y%m%d-%H%M%S)-$$"
mkdir -p "$BACKUP/files"
for f in $FILES;do
 if [ -f "$BASE/$f" ];then cp -p "$BASE/$f" "$BACKUP/files/$f";fi
done
cp -p "$SCOPE" "$BACKUP/three-tool-scope.json"
echo "BACKUP=$BACKUP"
APPLIED=1
for f in $FILES;do
 install -m 0644 "$STAGE/agent-stack/$f" "$BASE/$f"
done
cat "$STAGE/next-scope.json" > "$SCOPE"
chown 10000:10000 "$SCOPE"
chmod 0400 "$SCOPE"

echo "=== RESTART ONLY THREE AFFECTED SIDE CARS ==="
docker restart "$SCOUT" "$READ" "$BRIDGE" >/dev/null
ready=0
for n in $(seq 1 30);do
 a=$(docker inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$SCOUT")
 b=$(docker inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$READ")
 c=$(docker inspect -f '{{.State.Status}}' "$BRIDGE")
 if [ "$a" = running\|healthy ] && [ "$b" = running\|healthy ] && [ "$c" = running ];then
  ready=1;break
 fi
 sleep 3
done
test "$ready" = 1
echo "=== CONFIRM LIVE RUNNING SCOUT REVIEW PROJECTION ==="
docker exec "$SCOUT" node --input-type=module -e '
import {reviewQueue} from "/opt/workspace-agent/scout_review_projection.mjs";
const res=await fetch("http://play-scout-app-1:3000/api/crm",
  {signal:AbortSignal.timeout(30000)});
if(res.status!==200)process.exit(3);
const data=reviewQueue(await res.json(),30);
console.log("LIVE_REVIEW_READ_PASS COUNT="+data.count+" SAMPLE="+data.items.length);
'
echo "=== REJECT NON-AUTHORIZED QUEUE CALL ==="
docker exec "$SCOUT" node -e '
const http=require("node:http");
const body=JSON.stringify({capability:"synthetic-invalid-capability",
  operation:"scout_review_queue",params:{}});
const req=http.request({socketPath:"/run/three-tools/start.sock",path:"/read",
method:"POST",headers:{"content-type":"application/json",
"content-length":Buffer.byteLength(body)}},r=>{
 r.resume();r.on("end",()=>{
  console.log("INVALID_REVIEW_CAPABILITY_HTTP="+r.statusCode);
  if(r.statusCode!==403)process.exitCode=1;
 });
});
req.on("error",()=>process.exitCode=1);req.end(body);
'
APPLIED=0
echo "=== SUCCESS: HERMES CAN READ PLAY SCOUT REVIEW QUEUE THROUGH SIGNED TASK TOOLS ==="
echo "Existing tasks, mail, Scout search, Paperclip and customer data were not modified."
echo "A genuine active Hermes task is required for the signed read; no run was forged."
echo "BACKUP=$BACKUP"
