#!/usr/bin/env bash
# One verified Hermes agent, three services, fixed public Scout collection.
# No mail send/delete, arbitrary uploads, host shell or bypass of Paperclip.
set -Eeuo pipefail
umask 077
ROOT=/srv/hermes-stack
REPO=$ROOT/deployment-source
BASE=$REPO/agent-stack
SCOPE=$ROOT/private/three-tool-scope.json
IDENTITY=$ROOT/private/task-control.json
CONFIG=$ROOT/config/hermes-gateway.yaml
KEY=$ROOT/private/assistant-workspace.key
GATE=multi-mail-crm-tool-gateway-1
SCOUT=workspace-agent-scout-start-gateway-1
READ=workspace-agent-three-tool-read-1
RUN=workspace-agent-hermes-runtime-1
BRIDGE=workspace-agent-hermes-paperclip-bridge-1
IMAGE=workspace-paperclip:7e3caa7
FILES="three_tool_read_policy.mjs three_tool_read_scope.mjs three_tool_read_sidecar.mjs scout_start_gateway.mjs scout_collect_policy.mjs scout_review_projection.mjs task_control_mcp.py task_runtime_context.py serve_hermes.py hermes_gateway_bridge.py compose.three-tools.yaml"
compose(){
 docker compose -f "$BASE/compose.yaml" -f "$BASE/compose.paperclip.yaml" \
 -f "$BASE/compose.hermes-gateway.yaml" -f "$BASE/compose.task-control.yaml" \
 -f "$BASE/compose.three-tools.yaml" -f "$BASE/compose.scout-start.yaml" "$@"
}
[[ $EUID -eq 0 ]] || { echo "sudo required";exit 2; }
for exe in docker git python3 tar install mktemp;do command -v "$exe" >/dev/null;done
test -d "$REPO/.git" && test -s "$SCOPE" && test -s "$IDENTITY" && test -s "$CONFIG"
docker image inspect "$IMAGE" >/dev/null
for c in "$GATE" "$SCOUT" "$READ" "$RUN" "$BRIDGE";do
 test "$(docker inspect -f '{{.State.Status}}' "$c")" = running
done
STAGE=$(mktemp -d /tmp/hermes-all-tools.XXXXXXXX)
chmod 0755 "$STAGE"
BACKUP=
APPLIED=0
cleanup(){ rm -rf "$STAGE"; }
rollback(){
 if [[ $APPLIED != 1 || -z $BACKUP ]];then return;fi
 echo "ROLLBACK=$BACKUP" >&2
 for f in $FILES;do
  if [[ -f "$BACKUP/files/$f" ]];then cp -p "$BACKUP/files/$f" "$BASE/$f" || true
  else rm -f "$BASE/$f" || true;fi
 done
 cat "$BACKUP/scope.json" > "$SCOPE" || true
 cat "$BACKUP/config.yaml" > "$CONFIG" || true
 chown 10000:10000 "$SCOPE" || true
 chmod 0400 "$SCOPE" || true
 chmod 0444 "$CONFIG" || true
 if [[ -f "$BACKUP/key.old" ]];then
  install -m 0400 -o 10000 -g 10000 "$BACKUP/key.old" "$KEY" || true
 else rm -f "$KEY" || true;fi
 compose up -d --no-deps --pull never --force-recreate three-tool-read >/dev/null 2>&1 || true
 docker restart "$SCOUT" "$RUN" "$BRIDGE" >/dev/null 2>&1 || true
}
failed(){ ret=$?;trap - ERR;rollback;echo "FAILED=$ret BACKUP=$BACKUP" >&2;exit "$ret"; }
trap failed ERR
trap cleanup EXIT

REF=$(git -c safe.directory="$REPO" -C "$REPO" rev-parse FETCH_HEAD)
echo "=== STAGED COMMIT ==="
echo "FETCHED_COMMIT=$REF"
git -c safe.directory="$REPO" -C "$REPO" archive "$REF" agent-stack | tar -x -C "$STAGE"
chmod 0755 "$STAGE/agent-stack"
for f in $FILES;do test -s "$STAGE/agent-stack/$f";done

echo "=== OFFLINE SECURITY AND INTEGRATION TESTS ==="
docker run --rm --network none --read-only --cap-drop ALL \
 --security-opt no-new-privileges --user 10000:10000 \
 --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m \
 -v "$STAGE/agent-stack:/work:ro" -w /work --entrypoint node "$IMAGE" \
 --test tests/three_tool_read_policy.test.mjs tests/three_tool_read_scope.test.mjs \
 tests/three_tool_read_sidecar.integration.test.mjs tests/scout_gateway.integration.test.mjs \
 tests/scout_review_projection.test.mjs tests/scout_collect_policy.test.mjs
python3 -m py_compile "$STAGE/agent-stack/"{task_control_mcp.py,task_runtime_context.py,serve_hermes.py,hermes_gateway_bridge.py}
(cd "$STAGE/agent-stack" && PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p test_scoped_mcp_contract.py -v)

echo "=== REAL EXISTING ASSISTANT AND MAIL AUTH WITHOUT CONTENT LOGS ==="
docker exec "$GATE" node -e '
const http=require("node:http");
const key=process.env.WORKSPACE_SHARED_SECRET||"";
if(key.length<32)process.exit(2);
(async()=>{
 for(const item of [
 {name:"ASSISTANT",path:"/assistant/api/companies",
  headers:{"x-workspace-key":key,"x-workspace-role":"viewer"}},
 {name:"MAIL",path:"/mail-crm/companies",headers:{}}
 ]){
  const status=await new Promise((resolve,reject)=>{
   const req=http.get({hostname:"127.0.0.1",port:3200,path:item.path,
     headers:item.headers,timeout:10000},res=>{
      res.resume();res.on("end",()=>resolve(res.statusCode));
   });req.on("error",reject);req.on("timeout",()=>req.destroy());
  });
  console.log(item.name+"_VIEWER_HTTP="+status);
  if(status!==200)process.exitCode=1;
 }
})().catch(()=>process.exitCode=1);
'
docker exec "$GATE" node -e '
const key=process.env.WORKSPACE_SHARED_SECRET||"";
if(key.length<32||key.length>2048)process.exit(2);
process.stdout.write(key);
' > "$STAGE/key.new"
python3 - "$STAGE/key.new" <<'PY'
import pathlib,sys
k=pathlib.Path(sys.argv[1]).read_bytes()
assert 32<=len(k)<=2048 and b"\n" not in k and b"\r" not in k
print("Existing viewer credential verified; secret not shown")
PY

echo "=== REAL SCOUT MONITORS AND CRM ==="
docker exec "$SCOUT" node -e '
const http=require("node:http");
(async()=>{
 for(const p of ["/api/monitor","/api/web/monitor","/api/social/monitor",
  "/api/watch/monitor","/api/ai/monitor","/api/crm"]){
  const status=await new Promise((resolve,reject)=>{
   const req=http.get({hostname:"play-scout-app-1",port:3000,path:p,timeout:20000},r=>{
    let size=0;r.on("data",b=>{size+=b.length;if(size>24*1024*1024)r.destroy()});
    r.on("error",reject);r.on("end",()=>resolve(r.statusCode));
   });req.on("error",reject);req.on("timeout",()=>req.destroy());
  });
  console.log("SCOUT_HTTP="+status+" "+p);
  if(status!==200)process.exitCode=1;
 }
})().catch(()=>process.exitCode=1);
'

echo "=== PREPARE EXACT AGENT GRANTS AND 12-TOOL CONFIG ==="
docker run --rm --network none --read-only --cap-drop ALL \
 --security-opt no-new-privileges --user 10000:10000 \
 -v "$STAGE/agent-stack:/work:ro" -w /work --entrypoint node "$IMAGE" \
 --input-type=module -e 'import {listReadOperations} from "./three_tool_read_policy.mjs";
 console.log(JSON.stringify(listReadOperations().map(x=>x.name)));' > "$STAGE/catalog.json"
python3 - "$SCOPE" "$IDENTITY" "$CONFIG" "$STAGE" <<'PY'
import json,pathlib,re,sys
scope,identity,config,root=map(pathlib.Path,sys.argv[1:])
p=json.loads(scope.read_text());i=json.loads(identity.read_text())
aid,cid=i.get("agentId"),i.get("companyId")
assert isinstance(aid,str) and aid and isinstance(cid,str) and cid
assert p.get("version")==1 and isinstance(p.get("grants"),dict)
gmap=p.setdefault("agentGrants",{})
assert isinstance(gmap,dict)
g=gmap.get(aid)
if g is None:
 g={"agentId":aid,"companyId":cid,"companyIds":[],
    "operations":[],"workspaceWide":True,"mailConsent":True}
 gmap[aid]=g
assert g.get("agentId")==aid and g.get("companyId")==cid
assert g.get("workspaceWide") is True and g.get("mailConsent") is True
assert isinstance(g.get("operations"),list)
ops=json.loads((root/"catalog.json").read_text())
assert len(ops)>=35 and len(set(ops))==len(ops)
assert all(isinstance(x,str) and x.startswith(("scout_","assistant_","mail_")) for x in ops)
for op in ops+["scout_collect","scout_web"]:
 if op not in g["operations"]:g["operations"].append(op)
g["assistantConsent"]=True
g["assistantAllCompanies"]=True
for value in p["grants"].values():
 if isinstance(value,dict) and value.get("issueIdentifier")=="WOR-7" and value.get("workspaceWide") is True:
  assert isinstance(value.get("operations"),list)
  for op in ops+["scout_collect"]:
   if op not in value["operations"]:value["operations"].append(op)
  value["assistantConsent"]=True
  value["assistantAllCompanies"]=True
  value["mailConsent"]=True
assert not set(g["operations"]) & {"mail_send","mail_delete","external_upload","host_shell"}
(root/"scope.next").write_text(json.dumps(p,ensure_ascii=False,indent=2)+"\n")
text=config.read_text()
matches=list(re.finditer(r"(?m)^([ \t]*include:[ \t]*)\[([^\]\n]*)\][ \t]*$",text))
assert len(matches)==1
old={x.strip() for x in matches[0].group(2).split(",") if x.strip()}
allowed={"current_task","begin_task","submit_result","request_approval",
 "web_research","skills_memory","developer_status","scout_start",
 "scout_collect","scout_read","assistant_read","mail_crm_read"}
assert (allowed-{"scout_collect"})<=old and old<=allowed
new=matches[0].group(1)+"["+", ".join(sorted(allowed))+"]"
text=text[:matches[0].start()]+new+text[matches[0].end():]
(root/"config.next").write_text(text)
print("SCOPE_PASS: 1 trusted agent, 12 MCP tools, %d scoped read operations"%len(ops))
print("Explicit assistant viewer and mail read consent; no external send/delete.")
PY

echo "=== BACKUP ==="
BACKUP="$ROOT/backups/hermes-all-tools-$(date -u +%Y%m%d-%H%M%S)-$$"
mkdir -p "$BACKUP/files"
for f in $FILES;do
 if [[ -f "$BASE/$f" ]];then cp -p "$BASE/$f" "$BACKUP/files/$f";fi
done
cp -p "$SCOPE" "$BACKUP/scope.json"
cp -p "$CONFIG" "$BACKUP/config.yaml"
if [[ -f "$KEY" ]];then cp -p "$KEY" "$BACKUP/key.old";fi
printf 'commit=%s\n' "$REF" > "$BACKUP/manifest.txt"
echo "BACKUP=$BACKUP"
echo "=== APPLY ONLY REQUIRED FILES, SCOPE AND VIEWER KEY ==="
APPLIED=1
for f in $FILES;do install -m 0644 "$STAGE/agent-stack/$f" "$BASE/$f";done
install -m 0400 -o 10000 -g 10000 "$STAGE/key.new" "$KEY"
cat "$STAGE/scope.next" > "$SCOPE"
cat "$STAGE/config.next" > "$CONFIG"
chown 10000:10000 "$SCOPE"
chmod 0400 "$SCOPE"
chmod 0444 "$CONFIG"
compose config -q
compose up -d --no-deps --pull never --force-recreate three-tool-read
docker restart "$SCOUT" "$RUN" "$BRIDGE" >/dev/null

echo "=== CHECK RUNNING CONTAINERS ==="
ready=0
for attempt in $(seq 1 40);do
 good=1
 for c in "$SCOUT" "$READ" "$RUN";do
  s=$(docker inspect -f '{{.State.Status}}:{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$c")
  [[ $s = running:healthy ]] || good=0
 done
 [[ $(docker inspect -f '{{.State.Status}}' "$BRIDGE") = running ]] || good=0
 if [[ $good = 1 ]];then ready=1;break;fi
 sleep 3
done
[[ $ready = 1 ]]
[[ $(docker inspect -f '{{.HostConfig.NetworkMode}}' "$RUN") = none ]]
echo "HEALTH_OK; HERMES_NETWORK=none"

echo "=== CONFIRM LIVE VIEWER ASSISTANT AND MAIL READ ==="
docker exec "$READ" node -e '
const http=require("node:http"),fs=require("node:fs");
const key=fs.readFileSync("/run/secrets/assistant-workspace.key","utf8").trim();
(async()=>{
 for(const item of [
  {name:"ASSISTANT",path:"/assistant/api/companies",
   headers:{"x-workspace-key":key,"x-workspace-role":"viewer"}},
  {name:"MAIL",path:"/mail-crm/companies",headers:{}}
 ]){
  const code=await new Promise((resolve,reject)=>{
   const req=http.get({hostname:"multi-mail-crm-tool-gateway-1",port:3200,
    path:item.path,headers:item.headers,timeout:12000},res=>{
    res.resume();res.on("end",()=>resolve(res.statusCode));
   });req.on("error",reject);req.on("timeout",()=>req.destroy());
  });
  console.log("LIVE_"+item.name+"_READ_HTTP="+code);
  if(code!==200)process.exitCode=1;
 }
})().catch(()=>process.exitCode=1);
'

echo "=== VERIFY INVALID CAPABILITIES CANNOT READ ANY SERVICE ==="
docker exec "$READ" node -e '
const http=require("node:http");
(async()=>{
 for(const operation of ["scout_review_queue","assistant_companies","mail_messages"]){
  const body=JSON.stringify({capability:"synthetic-invalid-capability",operation,params:{}});
  const code=await new Promise((resolve,reject)=>{
   const req=http.request({socketPath:"/run/three-tools/read.sock",path:"/read",
    method:"POST",headers:{"content-type":"application/json",
    "content-length":Buffer.byteLength(body)}},res=>{
      res.resume();res.on("end",()=>resolve(res.statusCode));
    });req.on("error",reject);req.end(body);
  });
  console.log("INVALID_"+operation+"_HTTP="+code);
  if(code!==403)process.exitCode=1;
 }
})().catch(()=>process.exitCode=1);
'

echo "=== CONFIRM LIVE 12-TOOL MCP MANIFEST ==="
docker exec -i "$RUN" /opt/hermes/.venv/bin/python /opt/workspace-agent/task_control_mcp.py <<'JSON' > "$STAGE/mcp.json"
{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
JSON
python3 - "$STAGE/mcp.json" "$STAGE/catalog.json" <<'PY'
import json,sys
listed=json.load(open(sys.argv[1]))["result"]["tools"]
got={x["name"] for x in listed}
expected={"current_task","begin_task","submit_result","request_approval",
 "web_research","skills_memory","developer_status","scout_start",
 "scout_collect","scout_read","assistant_read","mail_crm_read"}
assert got==expected,(got,expected)
assert not got & {"send_mail","exec","shell","delete"}
print("LIVE_MCP_PASS: 12 tools, %d read operations"%len(json.load(open(sys.argv[2]))))
PY
APPLIED=0
echo "=== SUCCESS: HERMES CONNECTED TO THREE SERVICES WITH ACTIVE TASK AUTH ==="
echo "No email sent, no customer records changed and no Paperclip run lock modified."
echo "BACKUP=$BACKUP"
