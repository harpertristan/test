"""Read run/task ownership metadata and controller authentication; never mutate tasks."""

import hashlib
import hmac
import json
import re
import sqlite3

from bootstrap_owner import BASE, HERE, ROOT, run

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

      issueId:typeof context.issueId === 'string'?context.issueId:null,
      taskId:typeof context.taskId === 'string'?context.taskId:null,
      taskFound:!!issue,taskStatus:issue?.status ?? null,
      assigneeMatches:issue?.assigneeAgentId === identity.agentId,
      executionRunId:issue?.executionRunId ?? null,
      executionMatches:issue?.executionRunId === row.id,
      checkoutRunId:issue?.checkoutRunId ?? null,
      checkoutMatches:issue?.checkoutRunId === row.id}));
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


def inspect_calls(root=ROOT):
    """Compare recorded grants privately, emit only booleans and public run UUIDs."""
    database = root / "state/hermes-gateway/state.db"
    signing = root / "private/task-capability.key"
    if not database.exists() or not signing.exists():
        print("Local call diagnostic: no recorded database")
        return
    key = signing.read_bytes()
    connection = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)
    count = 0
    try:
        rows = connection.execute(
            "SELECT tool_calls FROM messages WHERE role='assistant' AND tool_calls IS NOT NULL ORDER BY id DESC LIMIT 8"
        )
        for (raw,) in rows:
            try:
                calls = json.loads(raw)
                if not isinstance(calls, list):
                    continue
                for call in calls:
                    function = call.get("function", {})
                    name = function.get("name")
                    if name not in (
                        "mcp__paperclip_task__current_task",
                        "mcp__paperclip_task__submit_result",
                    ):
                        continue
                    args = function.get("arguments", {})
                    if isinstance(args, str):
                        args = json.loads(args)
                    value = args.get("capability")
                    valid_format = isinstance(value, str) and bool(
                        re.fullmatch(
                            r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{10}:[0-9a-f]{64}",
                            value,
                        )
                    )
                    valid_signature = False
                    run_id = None
                    if valid_format:
                        run_id, expiry, signature = value.split(":")
                        expected = hmac.new(
                            key, f"{run_id}:{expiry}".encode(), hashlib.sha256
                        ).hexdigest()
                        valid_signature = hmac.compare_digest(signature, expected)
                    print(
                        json.dumps(
                            {
                                "tool": name,
                                "capabilityPresent": isinstance(value, str),
                                "formatValid": valid_format,
                                "signatureValid": valid_signature,
                                "runId": run_id,
                            }
                        )
                    )
                    count += 1
            except (ValueError, TypeError, AttributeError):
                print("Recorded call could not be parsed; arguments were not printed.")
        print(f"Recorded task calls inspected: {count}. No capability values printed.")
    finally:
        connection.close()


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
    inspect_calls()


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, sqlite3.Error):
        raise SystemExit(
            "Read-only diagnostic unavailable; secret details suppressed"
        ) from None
