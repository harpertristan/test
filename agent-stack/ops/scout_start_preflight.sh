#!/usr/bin/env bash
# No mutation: inspect Scout search prerequisites for a controlled Hermes integration.
set -Eeuo pipefail
BASE="/srv/hermes-stack/deployment-source/agent-stack"
[[ -d "$BASE" ]] || { echo "Unexpected server layout" >&2; exit 2; }
for x in docker python3; do command -v "$x" >/dev/null || exit 2; done

echo "=== LOCAL SCOUT AND HERMES NETWORK TOPOLOGY ==="
for n in play-scout-app-1 workspace-agent-three-tool-read-1 workspace-agent-hermes-runtime-1 multi-mail-crm-tool-gateway-1; do
  if docker inspect "$n" >/dev/null 2>&1; then
    docker inspect -f '{{.Name}} | {{.State.Status}} | {{range $name,$conf := .NetworkSettings.Networks}}{{$name}} {{end}}' "$n"
  else
    echo "$n | not found"
  fi
done

echo "=== SCOUT START-MANY SOURCE VALIDATION (SOURCE ONLY) ==="
docker exec play-scout-app-1 node -e '
const fs=require("node:fs");
const p="/app/lib/source-workspace.js";
const s=fs.readFileSync(p,"utf8");
const begin=s.indexOf("async function startMany(");
if(begin<0){ console.log("startMany not found"); process.exitCode=2; }
else{
  const end=s.indexOf("async function",begin+20);
  const chunk=s.slice(begin,end>begin?end:begin+9000);
  for(const line of chunk.split("\n")){
    if(/ids|requestId|allowPaid|analys|duplicate|queued|return|start\(/i.test(line))
      console.log(line.substring(0,240));
  }
}
'

echo "=== SCOUT STATIC SOURCE IDS ==="
docker exec play-scout-app-1 node -e '
const fs=require("node:fs");
const p="/app/lib/source-workspace.js";
const s=fs.readFileSync(p,"utf8");
for(const line of s.split("\n"))
 if(/SEARCH_CHANNELS|kind:|id:|enabled|sourceWorkspace.startMany/.test(line))
   console.log(line.substring(0,180));
'

echo "=== SCOUT MONITOR / COUNTS (NO RECORD CONTENT) ==="
docker exec play-scout-app-1 node -e '
const http=require("node:http");
const paths=["/api/monitor","/api/candidates","/api/findings","/api/defaults"];
(async()=>{for(const path of paths)await new Promise(done=>{
const req=http.get({hostname:"127.0.0.1",port:3000,path,timeout:5000},r=>{
let s="";r.on("data",x=>{if(s.length<200000)s+=x});r.on("end",()=>{
try{const v=JSON.parse(s); const o={http:r.statusCode,path};
if(Array.isArray(v)) o.count=v.length;
else if(path==="/api/monitor")for(const k of ["busy","activeJobId","lastError","totalCandidates","totalFindings"])o[k]=v[k]??null;
else o.fields=Object.keys(v).slice(0,12);
console.log(JSON.stringify(o));
}catch{console.log(JSON.stringify({path,http:r.statusCode,format:"not-json"}));}
done()})});
req.on("error",e=>{console.log(path+" "+e.code);done()});
req.on("timeout",()=>req.destroy());})})();
'

echo "=== LAST SCOPED REFUSAL CODES (NO REQUEST CONTENT) ==="
docker logs --since 20m workspace-agent-task-control-1 2>&1 |
  grep 'task_control_refused' |
  sed -E 's/.*"stage":"([^"]*)".*"code":"([^"]*)".*/stage=\1 code=\2/' | tail -8 || true
echo "=== FINISHED: NO SEARCH OR DATABASE MUTATION ==="
