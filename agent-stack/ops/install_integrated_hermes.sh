#!/usr/bin/env bash
# Unified safe Hermes operator installation with live Scout and Paperclip probes.
# No outgoing mail, data uploads, unrestricted shell or unaudited production edits.
set -Eeuo pipefail
umask 077
ROOT=/srv/hermes-stack
REPO=$ROOT/deployment-source
BASE=$REPO/agent-stack
SCOPE=$ROOT/private/three-tool-scope.json
IDENTITY=$ROOT/private/task-control.json
CONF=$ROOT/config/hermes-gateway.yaml
PAPER=workspace-agent-paperclip-1
CONTROL=workspace-agent-task-control-1
START=workspace-agent-scout-start-gateway-1
READ=workspace-agent-three-tool-read-1
RUN=workspace-agent-hermes-runtime-1
BRIDGE=workspace-agent-hermes-paperclip-bridge-1
ISSUE=2d95562b-a3f8-465e-bfa9-842dbd950acb
FILES="task_control_policy.mjs task_control.mjs task_control_mcp.py task_runtime_context.py serve_hermes.py hermes_gateway_bridge.py scout_start_gateway.mjs scout_web_policy.mjs scout_web_fetch.mjs skills_memory.py developer_engine.py"
UNIT=hermes-developer-engine
NEEDED="current_task begin_task submit_result request_approval web_research scout_start scout_read assistant_read mail_crm_read skills_memory developer_status"

test "$EUID" -eq 0 || { echo "ERROR: sudo required" >&2;exit 2; }
for exe in git docker python3 tar mktemp install systemctl;do command -v "$exe" >/dev/null;done
test -d "$REPO/.git" && test -s "$SCOPE" && test -s "$IDENTITY" && test -s "$CONF"
for c in "$PAPER" "$CONTROL" "$READ" "$START" "$RUN" "$BRIDGE";do docker inspect "$c" >/dev/null;done
STAGE=$(mktemp -d /tmp/hermes-operator.XXXXXXXX)
BACKUP=
MODIFIED=0
cleanup(){ rm -rf "$STAGE"; }
restore(){
 if [ "$MODIFIED" != 1 ] || [ -z "$BACKUP" ];then return;fi
 echo "ROLLBACK TO: $BACKUP" >&2
 systemctl disable --now "$UNIT.timer" >/dev/null 2>&1 || true
 for f in $FILES;do
  if [ -f "$BACKUP/files/$f" ];then cp -p "$BACKUP/files/$f" "$BASE/$f" || true
  else rm -f "$BASE/$f" || true;fi
 done
 cat "$BACKUP/scope.json" > "$SCOPE" || true
 cat "$BACKUP/hermes-gateway.yaml" > "$CONF" || true
 chown 10000:10000 "$SCOPE" || true
 chmod 0400 "$SCOPE" || true
 chmod 0444 "$CONF" || true
 for name in "$UNIT.service" "$UNIT.timer";do
  if [ -f "$BACKUP/$name" ];then cp -p "$BACKUP/$name" "/etc/systemd/system/$name" || true
  else rm -f "/etc/systemd/system/$name" || true;fi
 done
 systemctl daemon-reload || true
 docker restart "$CONTROL" "$START" "$READ" "$RUN" "$BRIDGE" >/dev/null 2>&1 || true
}
failed(){ ret=$?;trap - ERR;restore;echo "INSTALLATION FAILED: $ret. BACKUP: $BACKUP" >&2;exit "$ret"; }
trap failed ERR
trap cleanup EXIT

REF=$(git -c safe.directory="$REPO" -C "$REPO" rev-parse FETCH_HEAD)
echo "=== FETCHED SOURCE: $REF ==="
git -c safe.directory="$REPO" -C "$REPO" archive "$REF" agent-stack | tar -x -C "$STAGE"
chmod 755 "$STAGE" "$STAGE/agent-stack"
for f in $FILES;do test -s "$STAGE/agent-stack/$f";done
for f in "$UNIT.service" "$UNIT.timer";do test -s "$STAGE/agent-stack/ops/$f";done

echo "=== SYNTAX AND CROSS-LANGUAGE CONTRACT TESTS ==="
for f in task_control.mjs task_control_policy.mjs scout_start_gateway.mjs scout_web_policy.mjs scout_web_fetch.mjs three_tool_read_sidecar.mjs;do
 docker run --rm --network none -v "$STAGE/agent-stack:/work:ro" -w /work \
  --entrypoint node workspace-paperclip:7e3caa7 --check "$f" >/dev/null
done
python3 -m py_compile "$STAGE/agent-stack/"{task_control_mcp.py,task_runtime_context.py,serve_hermes.py,hermes_gateway_bridge.py,skills_memory.py,developer_engine.py}
(cd "$STAGE/agent-stack" && PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_*mcp_contract.py' -v)
(cd "$STAGE/agent-stack" && PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p test_task_read_gate.py -v)
(cd "$STAGE/agent-stack" && PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p test_skills_memory.py -v)
(cd "$STAGE/agent-stack" && PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p test_developer_engine.py -v)
docker run --rm --network none --read-only --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m \
 -v "$STAGE/agent-stack:/work:ro" -w /work --entrypoint node workspace-paperclip:7e3caa7 --test \
 tests/task_control_policy.test.mjs tests/three_tool_read_scope.test.mjs \
 tests/hermes_scout_contract.test.mjs tests/scout_start_policy.test.mjs \
 tests/scout_web_policy.test.mjs tests/scout_web_fetch.test.mjs \
 tests/three_tool_read_sidecar.integration.test.mjs tests/scout_gateway.integration.test.mjs

echo "=== PREPARE ONE AGENT READ/RESEARCH SCOPE AND MCP CONFIG ==="
python3 - "$SCOPE" "$IDENTITY" "$CONF" "$STAGE" "$ISSUE" <<'PY'
import json,pathlib,re,sys
scope_path,identity_path,config_path,dir_path,issue_id=sys.argv[1:]
root=pathlib.Path(dir_path)
policy=json.load(open(scope_path))
identity=json.load(open(identity_path))
agent,company=identity.get("agentId"),identity.get("companyId")
assert all(isinstance(x,str) and x for x in (agent,company))
assert policy.get("version")==1 and isinstance(policy.get("grants"),dict)
specific=policy["grants"].get(issue_id)
assert isinstance(specific,dict) and specific.get("issueIdentifier")=="WOR-7"
assert specific.get("workspaceWide") is True and isinstance(specific.get("operations"),list)
if "scout_web" not in specific["operations"]:specific["operations"].append("scout_web")
defaults=policy.setdefault("agentGrants",{})
assert isinstance(defaults,dict)
default=defaults.get(agent)
if default is None:
 default={"agentId":agent,"companyId":company,"workspaceWide":True,
          "mailConsent":True,"companyIds":[],"operations":[
          "scout_candidates","scout_findings","scout_monitor","scout_active",
          "assistant_companies","mail_companies","mail_tasks","mail_messages","mail_message"]}
 defaults[agent]=default
assert default.get("agentId")==agent and default.get("companyId")==company
assert default.get("workspaceWide") is True and default.get("mailConsent") is True
assert isinstance(default.get("operations"),list)
if "scout_web" not in default["operations"]:default["operations"].append("scout_web")
assert not set(default["operations"]) & {"mail_send","mail_delete","external_post"}
(root/"scope.next").write_text(json.dumps(policy,ensure_ascii=False,indent=2)+"\n")
conf=pathlib.Path(config_path).read_text()
matches=list(re.finditer(r"(?m)^([ \t]*include:[ \t]*)\[([^\]\n]+)\][ \t]*$",conf))
assert len(matches)==1,"Unexpected Hermes MCP config"
existing={x.strip() for x in matches[0].group(2).split(",")}
base={"current_task","submit_result","scout_start","scout_read","assistant_read","mail_crm_read"}
assert base.issubset(existing),"Existing tools not recognized"
expected=base|{"begin_task","request_approval","web_research","skills_memory","developer_status"}
assert existing.issubset(expected),"Unrecognized current tool permissions"
new=matches[0].group(1)+"["+", ".join(sorted(expected))+"]"
conf=conf[:matches[0].start()]+new+conf[matches[0].end():]
(root/"config.next").write_text(conf)
print("Validated: one verified Hermes, 11 tools, public Scout browsing and memory")
print("Outbound send/upload: not granted. Agent-specific tasks still signed.")
PY

echo "=== BACK UP CURRENT DEPLOYMENT ==="
BACKUP=$ROOT/backups/hermes-integrated-$(date -u +%Y%m%d-%H%M%S)-$$
mkdir -p "$BACKUP/files"
for f in $FILES;do
 if [ -f "$BASE/$f" ];then cp -p "$BASE/$f" "$BACKUP/files/$f";fi
done
cp -p "$SCOPE" "$BACKUP/scope.json"
cp -p "$CONF" "$BACKUP/hermes-gateway.yaml"
for f in "$UNIT.service" "$UNIT.timer";do
 if [ -f "/etc/systemd/system/$f" ];then cp -p "/etc/systemd/system/$f" "$BACKUP/$f";fi
done
printf 'commit=%s\n' "$REF" > "$BACKUP/manifest.txt"
echo "BACKUP: $BACKUP"

echo "=== APPLY SOURCE, SCOPE AND MCP CONFIG IN PLACE ==="
MODIFIED=1
for f in $FILES;do install -m 0644 "$STAGE/agent-stack/$f" "$BASE/$f";done
cat "$STAGE/scope.next" > "$SCOPE"
cat "$STAGE/config.next" > "$CONF"
chown 10000:10000 "$SCOPE"
chmod 0400 "$SCOPE"
chmod 0444 "$CONF"

echo "=== INSTALL DEVELOPER ENGINE SCHEDULE ==="
DEV_OUT=$ROOT/state/hermes-gateway/developer-reports
mkdir -p "$DEV_OUT"
chown 10000:10000 "$DEV_OUT"
chmod 0700 "$DEV_OUT"
install -m 0644 "$STAGE/agent-stack/ops/$UNIT.service" "/etc/systemd/system/$UNIT.service"
install -m 0644 "$STAGE/agent-stack/ops/$UNIT.timer" "/etc/systemd/system/$UNIT.timer"
systemctl daemon-reload
systemctl enable --now "$UNIT.timer"

echo "=== RESTART AFFECTED CONTAINERS ==="
docker restart "$CONTROL" "$START" "$READ" "$RUN" "$BRIDGE" >/dev/null
health(){
 local c status
 for c in "$CONTROL" "$START" "$READ" "$RUN";do
  status=$(docker inspect -f '{{.State.Status}}:{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$c")
  [ "$status" = running:healthy ] || return 1
 done
 [ "$(docker inspect -f '{{.State.Status}}' "$BRIDGE")" = running ] || return 1
}
echo "=== WAIT FOR LIVE CONTAINER HEALTH ==="
ready=0
for n in $(seq 1 45);do if health;then ready=1;break;fi;sleep 4;done
[ "$ready" = 1 ]
[ "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$RUN")" = none ]
echo "ALL SERVICES HEALTHY; HERMES NETWORK=none"

echo "=== REAL SCOUT NETWORK AND PUBLIC HTTPS PROBE ==="
docker exec "$START" node --input-type=module -e '
import http from "node:http";
const reply=await new Promise((resolve,reject)=>{
http.get({hostname:"play-scout-app-1",port:3000,path:"/api/monitor",timeout:6000},r=>{
r.resume();r.on("end",()=>resolve(r.statusCode))}).on("error",reject);
});
console.log("Scout monitor HTTP",reply);
if(reply!==200)process.exit(1);
const {publicOpen}=await import("/opt/workspace-agent/scout_web_fetch.mjs");
let success=false;
for(const url of ["https://example.com/","https://www.google.com/","https://github.com/"]){
 try{const page=await publicOpen(url);
  if(page.status===200&&page.text.length>10){console.log("Public HTTPS live: 200",new URL(page.sourceUrl).hostname);success=true;break;}
 }catch(e){console.log("Probe rejected:",String(e?.message||"UNAVAILABLE").slice(0,90))}
}
if(!success)process.exit(2);
'
echo "=== VERIFY INVALID READ AND BROWSER TOKENS ARE REJECTED ==="
docker exec "$START" node -e '
const http=require("node:http");
const data=JSON.stringify({capability:"synthetic-invalid-capability",action:"search",query:"UK business account banks"});
const r=http.request({socketPath:"/run/three-tools/start.sock",path:"/web",method:"POST",
headers:{"content-type":"application/json","content-length":Buffer.byteLength(data)}},v=>{
v.resume();v.on("end",()=>{console.log("Unauthorized web HTTP",v.statusCode);if(v.statusCode!==403)process.exitCode=1})});
r.on("error",()=>process.exitCode=1);r.end(data);
'

echo "=== VERIFY LIVE MCP TOOL MANIFEST ==="
docker exec -i "$RUN" /opt/hermes/.venv/bin/python /opt/workspace-agent/task_control_mcp.py <<'JSON' > "$STAGE/live-mcp.json"
{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
JSON
python3 - "$STAGE/live-mcp.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
names={x["name"] for x in r["result"]["tools"]}
expected={"current_task","begin_task","submit_result","request_approval",
 "web_research","skills_memory","developer_status","scout_start","scout_read",
 "assistant_read","mail_crm_read"}
assert names==expected,(names,expected)
assert "send_mail" not in names and "shell" not in names
print("Live Hermes MCP: 11 approved tools; no mail-send/host shell")
PY

echo "=== REAL DEVELOPER ENGINE DIAGNOSTIC ==="
python3 "$BASE/developer_engine.py" --repo "$BASE" --out "$DEV_OUT"
docker exec -i "$RUN" /opt/hermes/.venv/bin/python -c '
import pathlib,json
p=pathlib.Path("/opt/data/developer-reports/report.json")
data=json.loads(p.read_text())
assert "fingerprint" in data
print("Developer report readable from Hermes runtime")
'
echo "=== SYSTEMD TIMER ==="
systemctl is-enabled --quiet "$UNIT.timer"
systemctl is-active --quiet "$UNIT.timer"

MODIFIED=0
echo "=== CONFIGURATION INSTALLED AND LIVE SCOUT HTTPS VERIFIED ==="
echo "Backup: $BACKUP"
echo "=== REQUEST REAL PAPERCLIP WOR-7 WAKEUP (NEVER FORGE RUN LOCKS) ==="
docker exec --workdir /app/cli "$CONTROL" node --import tsx --input-type=module -e '
import {createRequire} from "node:module";
import http from "node:http";
import fs from "node:fs";
const require=createRequire("/app/server/package.json");
const {createDb,issues}=await import(require.resolve("@paperclipai/db"));
const {eq}=await import(require.resolve("drizzle-orm"));
const identity=JSON.parse(fs.readFileSync("/run/secrets/task-control.json","utf8"));
const [issue]=await createDb(process.env.DATABASE_URL).select().from(issues)
.where(eq(issues.id,process.argv[1])).limit(1);
if(!issue){console.log("LIVE_WAKE_SKIPPED: ISSUE_NOT_FOUND");process.exit(0)}
if(issue.assigneeAgentId!==identity.agentId||issue.companyId!==identity.companyId){
console.log("LIVE_WAKE_SKIPPED: ISSUE_NOT_ASSIGNED_TO_HERMES");process.exit(0)}
if(!["todo","in_progress"].includes(issue.status)){
console.log("LIVE_WAKE_SKIPPED: ISSUE_STATUS_"+issue.status);process.exit(0)}
const payload=JSON.stringify({
 source:"on_demand",triggerDetail:"manual",reason:"Hermes integrated operator live smoke",
 payload:{issueId:issue.id},idempotencyKey:"hermes-integrated-smoke-"+process.argv[2]
});
const request=http.request({
 hostname:"127.0.0.1",port:3100,path:"/api/agents/"+identity.agentId+"/wakeup",method:"POST",
 headers:{authorization:"Bearer "+identity.token,"content-type":"application/json",
 "content-length":Buffer.byteLength(payload)},timeout:12000
},response=>{
 let text="";
 response.on("data",v=>{text+=v;if(text.length>16000)response.destroy()});
 response.on("end",()=>{
  let responseStatus=null;
  try{
   const o=JSON.parse(text);
   responseStatus=o.status||o.reason||o.code||o.skipReason||"accepted";
  }catch{responseStatus="invalid_response"}
  console.log("PAPERCLIP_LIVE_WAKE_HTTP="+response.statusCode,
    "STATUS="+String(responseStatus).slice(0,90));
 })
});
request.on("timeout",()=>request.destroy());
request.on("error",()=>console.log("PAPERCLIP_WAKE_CONNECTION_ERROR"));
request.end(payload);
' "$ISSUE" "$REF" || true

echo "=== LAST PAPERCLIP ISSUE/RUN METADATA ==="
docker exec --workdir /app/cli "$CONTROL" node --import tsx --input-type=module -e '
import {createRequire} from "node:module";
import fs from "node:fs";
const require=createRequire("/app/server/package.json");
const {createDb,issues,heartbeatRuns}=await import(require.resolve("@paperclipai/db"));
const {eq,desc}=await import(require.resolve("drizzle-orm"));
const identity=JSON.parse(fs.readFileSync("/run/secrets/task-control.json","utf8"));
const db=createDb(process.env.DATABASE_URL);
const [issue]=await db.select().from(issues).where(eq(issues.id,process.argv[1])).limit(1);
if(issue)console.log(JSON.stringify({issue:"WOR-7",status:issue.status,
 bound:!!(issue.checkoutRunId||issue.executionRunId),assigned:issue.assigneeAgentId===identity.agentId}));
for(const run of await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId,identity.agentId))
.orderBy(desc(heartbeatRuns.createdAt)).limit(3)){
const id=run.issueId??run.contextSnapshot?.issueId??run.contextSnapshot?.taskId;
console.log(JSON.stringify({runStatus:run.status,isWOR7:!!issue&&id===issue.id,
 createdAt:run.createdAt}));
}
' "$ISSUE" || true
echo "=== INSTALL COMPLETE; CHECK LIVE WAKE STATUS ABOVE ==="
echo "No messages sent. No production code change will be applied by Hermes without human review."
