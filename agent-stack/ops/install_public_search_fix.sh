#!/usr/bin/env bash
# Targeted live-proven search fix; leaves Paperclip, task status, agent permissions and DB unchanged.
set -Eeuo pipefail
umask 077
ROOT=/srv/hermes-stack
REPO=$ROOT/deployment-source
BASE=$REPO/agent-stack
SCOUT=workspace-agent-scout-start-gateway-1
BRIDGE=workspace-agent-hermes-paperclip-bridge-1
IMAGE=workspace-paperclip:7e3caa7
FILES="scout_web_fetch.mjs hermes_gateway_bridge.py"
test "$EUID" -eq 0 || { echo "ERROR: run with sudo" >&2;exit 2; }
for binary in docker git python3 tar mktemp;do command -v "$binary" >/dev/null;done
test -d "$REPO/.git"
test "$(docker inspect -f '{{.State.Status}}' "$SCOUT")" = running
test "$(docker inspect -f '{{.State.Status}}' "$BRIDGE")" = running
TEMP="$(mktemp -d /tmp/hermes-searchfix.XXXXXXXX)"
chmod 755 "$TEMP"
BACKUP=
MUTATED=0
restore(){
 if [ "$MUTATED" = 1 ];then
  echo "ROLLBACK: restoring previous search and gateway code" >&2
  for f in $FILES;do cp -p "$BACKUP/$f" "$BASE/$f" || true;done
  docker restart "$SCOUT" "$BRIDGE" >/dev/null 2>&1 || true
 fi
}
failed(){
 local code=$?
 trap - ERR
 restore
 echo "SEARCH_FIX_FAILED: $code. BACKUP=$BACKUP" >&2
 exit "$code"
}
trap failed ERR
trap 'rm -rf "$TEMP"' EXIT
REF="$(git -c safe.directory="$REPO" -C "$REPO" rev-parse FETCH_HEAD)"
echo "=== VERIFY FETCHED RELEASE ==="
echo "commit=$REF"
git -c safe.directory="$REPO" -C "$REPO" archive "$REF" agent-stack | tar -x -C "$TEMP"
chmod 755 "$TEMP/agent-stack"
for f in $FILES;do test -s "$BASE/$f" && test -s "$TEMP/agent-stack/$f";done

echo "=== SYNTAX AND REGRESSION TESTS ==="
docker run --rm --network none --read-only --cap-drop ALL \
 --security-opt no-new-privileges --user 10000:10000 \
 -v "$TEMP/agent-stack:/work:ro" -w /work --entrypoint node "$IMAGE" \
 --check scout_web_fetch.mjs
python3 -m py_compile "$TEMP/agent-stack/hermes_gateway_bridge.py"
docker run --rm --network none --read-only --cap-drop ALL \
 --security-opt no-new-privileges --user 10000:10000 \
 --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m \
 -v "$TEMP/agent-stack:/work:ro" -w /work --entrypoint node "$IMAGE" \
 --test tests/scout_web_fetch.test.mjs tests/scout_web_policy.test.mjs

read -r -d '' PROBE <<'JS' || true
import {publicSearch,publicOpen} from "./scout_web_fetch.mjs";
const query="UK business account EMI company FCA";
const response=await publicSearch(query);
const urls=response.results||[];
console.log("SEARCH_RESULTS="+urls.length,
 "PROVIDER="+String(response.provider||"unavailable"));
if(urls.length<3){
 console.log("SEARCH_ERRORS="+JSON.stringify(response.providerErrors||[]));
 process.exit(3);
}
let opened=null;
for(const url of urls.slice(0,8)){
 try{
  const site=await publicOpen(url);
  if(site.status===200&&site.text.length>30){
   opened=new URL(site.sourceUrl).hostname;
   break;
  }
 }catch{}
}
if(!opened){
 console.log("CANDIDATE_PAGE_NOT_OPENED");
 process.exit(4);
}
console.log("CANDIDATE_PAGE_OPENED="+opened);
JS

echo "=== REAL SEARCH AND CANDIDATE OPEN: STAGED CODE, SERVER NETWORK ==="
# Exact same Scout container network, but only the staged read-only code is mounted.
docker run --rm --network "container:$SCOUT" --read-only --cap-drop ALL \
 --security-opt no-new-privileges --user 10000:10000 \
 --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m \
 -v "$TEMP/agent-stack:/work:ro" -w /work --entrypoint node "$IMAGE" \
 --input-type=module -e "$PROBE"

echo "=== BACKUP AND APPLY ==="
BACKUP="$ROOT/backups/hermes-searchfix-$(date -u +%Y%m%d-%H%M%S)-$$"
mkdir -p "$BACKUP"
for f in $FILES;do cp -p "$BASE/$f" "$BACKUP/$f";done
MUTATED=1
for f in $FILES;do install -m 0644 "$TEMP/agent-stack/$f" "$BASE/$f";done

echo "=== RESTART ONLY SCOUT BROWSER GATEWAY AND PAPERCLIP ADAPTER ==="
docker restart "$SCOUT" "$BRIDGE" >/dev/null
healthy=0
for n in $(seq 1 20);do
 status=$(docker inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$SCOUT")
 if [ "$status" = "running|healthy" ] &&
    [ "$(docker inspect -f '{{.State.Status}}' "$BRIDGE")" = running ];then
   healthy=1;break
 fi
 sleep 3
done
test "$healthy" = 1
echo "=== REAL SEARCH USING LIVE INSTALLED SCOUT GATEWAY CODE ==="
docker exec "$SCOUT" node --input-type=module -e '
import {publicSearch,publicOpen} from "/opt/workspace-agent/scout_web_fetch.mjs";
const result=await publicSearch("UK business account EMI company FCA");
if(!result.results||result.results.length<3)process.exit(3);
let opened=null;
for(const url of result.results.slice(0,8)){
  try{
    const page=await publicOpen(url);
    if(page.status===200&&page.text.length>30){opened=new URL(page.sourceUrl).hostname;break;}
  }catch{}
}
if(!opened)process.exit(4);
console.log("LIVE_SCOUT_SEARCH_PASS="+result.results.length+
  " LIVE_SOURCE="+result.provider+" LIVE_PAGE="+opened);
'
echo "=== VERIFY BROWSER IS STILL CLOSED TO UNAUTHORIZED CALLERS ==="
docker exec "$SCOUT" node -e '
const http=require("node:http");
const data=JSON.stringify({capability:"synthetic-invalid-capability",action:"search",query:"UK business bank"});
const req=http.request({socketPath:"/run/three-tools/start.sock",path:"/web",method:"POST",
headers:{"content-type":"application/json","content-length":Buffer.byteLength(data)}},res=>{
 res.resume();res.on("end",()=>{console.log("INVALID_CAPABILITY_HTTP="+res.statusCode);
 if(res.statusCode!==403)process.exitCode=1;});
});req.on("error",()=>process.exitCode=1);req.end(data);
'
MUTATED=0
echo "=== SUCCESS: PUBLIC BANK SEARCH NOW RETURNS DIRECT LINKS ==="
echo "Backup: $BACKUP"
echo "Paperclip, task data, permissions, mail policy and other containers unchanged."
echo "Pending human approvals are NOT accepted by this script."
