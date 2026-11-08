#!/usr/bin/env bash
# Restore Paperclip native queue/retry processing, safely and reversibly.
set -Eeuo pipefail
umask 077
ROOT=/srv/hermes-stack
BASE=$ROOT/deployment-source/agent-stack
CONFIG=$BASE/compose.paperclip.yaml
ISSUE=2d95562b-a3f8-465e-bfa9-842dbd950acb
PAPER=workspace-agent-paperclip-1
DB=workspace-agent-paperclip-db-1
CONTROL=workspace-agent-task-control-1
BRIDGE=workspace-agent-hermes-paperclip-bridge-1
HERMES=workspace-agent-hermes-runtime-1
compose(){
 docker compose -f "$BASE/compose.yaml" -f "$BASE/compose.paperclip.yaml" \
 -f "$BASE/compose.hermes-gateway.yaml" -f "$BASE/compose.task-control.yaml" \
 -f "$BASE/compose.three-tools.yaml" -f "$BASE/compose.scout-start.yaml" "$@"
}
test "$EUID" -eq 0 || { echo "sudo required" >&2;exit 2; }
for exe in docker python3 mktemp;do command -v "$exe" >/dev/null;done
test -s "$CONFIG"
for c in "$PAPER" "$DB" "$CONTROL" "$BRIDGE" "$HERMES";do docker inspect "$c" >/dev/null;done
STAGE=$(mktemp -d /tmp/paperclip-scheduler.XXXXXXXX)
BACKUP=
MODIFIED=0
cleanup(){ rm -rf "$STAGE"; }
rollback(){
 if [ "$MODIFIED" = 1 ];then
  echo "ROLLBACK $BACKUP" >&2
  cp -p "$BACKUP/compose.paperclip.yaml" "$CONFIG" || true
  compose up -d --no-deps --pull never --force-recreate paperclip task-control hermes-paperclip-bridge >/dev/null 2>&1 || true
 fi
}
fail(){ ec=$?;trap - ERR;rollback;echo "FAILED ($ec) BACKUP: $BACKUP" >&2;exit "$ec"; }
trap fail ERR
trap cleanup EXIT
echo "=== VERIFY SCHEDULER CONFIG BEFORE CHANGES ==="
python3 - "$CONFIG" "$STAGE/compose.paperclip.yaml" <<'PY'
import pathlib,sys
s=pathlib.Path(sys.argv[1]).read_text()
old="      HEARTBEAT_SCHEDULER_ENABLED: 'false'"
assert s.count(old)==1,"Unexpected scheduler config: no changes"
assert "HEARTBEAT_SCHEDULER_INTERVAL_MS" not in s,"Nondefault scheduler config: no changes"
assert "    image: workspace-paperclip:7e3caa7" in s,"Unrecognized Paperclip image"
new=s.replace(old,"      HEARTBEAT_SCHEDULER_ENABLED: 'true'\n      HEARTBEAT_SCHEDULER_INTERVAL_MS: '60000'")
pathlib.Path(sys.argv[2]).write_text(new)
print("VALID: enable native retry scheduler, 60-second tick")
PY
echo "=== VERIFY ISSUE OWNERSHIP WITHOUT MUTATION ==="
docker exec --workdir /app/cli "$CONTROL" node --import tsx --input-type=module -e '
import {createRequire} from "node:module";
const require=createRequire("/app/server/package.json");
const fs=require("node:fs");
const {createDb,issues}=await import(require.resolve("@paperclipai/db"));
const {eq}=await import(require.resolve("drizzle-orm"));
const identity=JSON.parse(fs.readFileSync("/run/secrets/task-control.json","utf8"));
const db=createDb(process.env.DATABASE_URL);
const [issue]=await db.select().from(issues).where(eq(issues.id,process.argv[1])).limit(1);
if(!issue){console.error("WOR-7 missing");process.exit(2)}
const owner=issue.assigneeAgentId===identity.agentId && issue.companyId===identity.companyId;
console.log(JSON.stringify({issue:"WOR-7",status:issue.status,assignedToHermes:owner,
 hasExecutionLock:Boolean(issue.executionRunId||issue.checkoutRunId)}));
if(issue.identifier!=="WOR-7"||!owner||!["todo","in_progress"].includes(issue.status))process.exit(2);
' "$ISSUE"
echo "=== BACKUP ==="
BACKUP=$ROOT/backups/paperclip-scheduler-$(date -u +%Y%m%d-%H%M%S)-$$
mkdir -p "$BACKUP"
cp -p "$CONFIG" "$BACKUP/compose.paperclip.yaml"
echo "=== APPLY: NATIVE PAPERCLIP ONLY ==="
MODIFIED=1
cp -p "$STAGE/compose.paperclip.yaml" "$CONFIG"
compose config -q
compose up -d --no-deps --pull never --force-recreate paperclip
compose up -d --no-deps --pull never --force-recreate task-control hermes-paperclip-bridge
echo "=== HEALTH AND CONFIGURATION ==="
good=0
for i in $(seq 1 36);do
 ok=1
 for c in "$PAPER" "$DB" "$CONTROL" "$HERMES";do
  status=$(docker inspect -f '{{.State.Status}}:{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$c")
  test "$status" = running:healthy || ok=0
 done
 test "$(docker inspect -f '{{.State.Status}}' "$BRIDGE")" = running || ok=0
 if [ "$ok" = 1 ];then good=1;break;fi
 sleep 5
done
test "$good" = 1
test "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$HERMES")" = none
docker exec "$PAPER" node -e '
if(process.env.HEARTBEAT_SCHEDULER_ENABLED!=="true"||
process.env.HEARTBEAT_SCHEDULER_INTERVAL_MS!=="60000")process.exit(1);
console.log("Scheduler enabled and verified, 60-second interval");
'
echo "=== SUCCESS ==="
MODIFIED=0
echo "SUCCESS: native queue/retry scheduler enabled. BACKUP: $BACKUP"
echo "No task row, run lock, queued message or mail content manually modified."
