#!/usr/bin/env bash
# Read-only diagnostic for a Paperclip-owned Hermes run. No secrets or record contents printed.
set -Eeuo pipefail
ISSUE=2d95562b-a3f8-465e-bfa9-842dbd950acb
for name in workspace-agent-task-control-1 workspace-agent-hermes-runtime-1 workspace-agent-hermes-paperclip-bridge-1 workspace-agent-three-tool-read-1; do
 echo "CONTAINER $name"
 docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$name"
done
echo "=== PAPERCLIP ISSUE AND LAST HERMES RUNS (METADATA ONLY) ==="
docker exec --workdir /app/cli workspace-agent-task-control-1 node --import tsx --input-type=module -e '
import {createRequire} from "node:module";
const require=createRequire("/app/server/package.json");
const {createDb,issues,heartbeatRuns}=await import(require.resolve("@paperclipai/db"));
const {eq,desc}=await import(require.resolve("drizzle-orm"));
const identity=JSON.parse(require("node:fs").readFileSync("/run/secrets/task-control.json","utf8"));
const db=createDb(process.env.DATABASE_URL);
const issueId=process.argv[1];
try {
 const matches=await db.select().from(issues).where(eq(issues.id,issueId)).limit(1);
 if(matches.length!==1){console.log(JSON.stringify({issueFound:false}));process.exit(0)}
 const issue=matches[0];
 console.log(JSON.stringify({issue:"WOR-7",status:issue.status,assignedToHermes:issue.assigneeAgentId===identity.agentId,
  correctCompany:issue.companyId===identity.companyId, executionRunId:issue.executionRunId||null,
  checkoutRunId:issue.checkoutRunId||null}));
 const rows=await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId,identity.agentId))
  .orderBy(desc(heartbeatRuns.createdAt)).limit(8);
 for(const run of rows) {
  const bound=run.issueId??run.contextSnapshot?.issueId??run.contextSnapshot?.taskId;
  console.log(JSON.stringify({runId:run.id,status:run.status,issueMatches:bound===issue.id,
    companyMatches:run.companyId===identity.companyId,lockMatches:
    run.id===issue.executionRunId||run.id===issue.checkoutRunId,
    startedAt:run.startedAt??null,createdAt:run.createdAt??null}));
 }
} catch(e){console.error("DB_DIAGNOSTIC_FAILED",e?.code||"UNKNOWN");process.exitCode=1;}
' "$ISSUE"
echo "=== RECENT TASK CONTROLLER DENIALS ==="
docker logs --since 60m workspace-agent-task-control-1 2>&1 | grep 'task_control_refused' | tail -12 | \
 sed -E 's/.*"stage":"([^"]*)".*"code":"([^"]*)".*/stage=\1 code=\2/' || true
echo "=== END: NO MUTATIONS, NO KEY MATERIAL ==="
