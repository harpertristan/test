"""Read run/task ownership metadata and controller authentication; never mutate tasks."""

from bootstrap_owner import BASE, HERE, run

PROGRAM = r"""
import {createRequire} from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
const require = createRequire('/app/server/package.json');
try {
  const {createDb,heartbeatRuns,issues} = await import(require.resolve('@paperclipai/db'));
  const {eq,desc} = await import(require.resolve('drizzle-orm'));
  const identity = JSON.parse(fs.readFileSync('/run/secrets/task-control.json','utf8'));
  const db = createDb(process.env.DATABASE_URL);
  const rows = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId,identity.agentId))
    .orderBy(desc(heartbeatRuns.createdAt)).limit(6);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  for (const row of rows) {
    const context = row.contextSnapshot || {};
    const id = row.issueId ?? context.issueId ?? context.taskId;
    let issue;
    if (typeof id === 'string' && uuid.test(id)) [issue] = await db.select().from(issues).where(eq(issues.id,id)).limit(1);
    console.log(JSON.stringify({runId:row.id,runStatus:row.status,
      companyMatches:row.companyId === identity.companyId,
      directIssueId:row.issueId ?? null,
      contextKeys:Object.keys(context),
      issueId:typeof context.issueId === 'string'?context.issueId:null,
      taskId:typeof context.taskId === 'string'?context.taskId:null,
      taskFound:!!issue,taskStatus:issue?.status ?? null,
      assigneeMatches:issue?.assigneeAgentId === identity.agentId,
      executionRunId:issue?.executionRunId ?? null,
      executionMatches:issue?.executionRunId === row.id}));
  }
  await new Promise(resolve => {
    const request = http.get({hostname:'127.0.0.1',port:3100,path:'/api/agents/me',
      headers:{Authorization:`Bearer ${identity.token}`}}, response => {
      response.resume(); console.log('Controller API authentication: HTTP ' + response.statusCode); resolve();
    });
    request.setTimeout(10000,()=>request.destroy());
    request.on('error',()=>{console.log('Controller API authentication: unavailable');resolve();});
  });
  console.log('Read-only diagnostic complete. No keys, prompts or task descriptions were printed.');
  process.exit(0);
} catch {
  console.log('Read-only diagnostic failed; secret error details suppressed.');
  process.exit(0);
}
"""


def main():
    command = BASE + [
        "-f",
        str(HERE / "compose.hermes-gateway.yaml"),
        "-f",
        str(HERE / "compose.task-control.yaml"),
        "exec",
        "-T",
        "task-control",
        "node",
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        PROGRAM,
    ]
    print(run(command), end="")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError) as error:
        raise SystemExit(str(error)) from None
