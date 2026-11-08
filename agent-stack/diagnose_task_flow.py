"""Read-only Hermes/Paperclip task-state report; never prints grants or credentials.

Usage (on host with docker access):
  python3 diagnose_task_flow.py WOR-7
"""
import json
import re
import subprocess
import sys

IDENTIFIER = re.compile(r"^[A-Z][A-Z0-9_-]{0,31}-[0-9]{1,12}$")

def main():
    if len(sys.argv) != 2 or not IDENTIFIER.fullmatch(sys.argv[1]):
        raise SystemExit("Usage: python3 diagnose_task_flow.py WOR-7")
    identifier = sys.argv[1]
    sql = """
SELECT json_build_object(
  'issue', (SELECT json_build_object(
    'id', id, 'identifier', identifier, 'status', status,
    'execution_run_id', execution_run_id, 'checkout_run_id', checkout_run_id,
    'assignee_agent_id', assignee_agent_id, 'company_id', company_id)
    FROM issues WHERE identifier = '{identifier}'),
  'runs', COALESCE((SELECT json_agg(x) FROM (
     SELECT id, status, issue_id, agent_id, company_id, created_at, finished_at,
            context_snapshot->>'issueId' AS context_issue_id,
            context_snapshot->>'taskId' AS context_task_id
     FROM heartbeat_runs
     WHERE issue_id = (SELECT id FROM issues WHERE identifier = '{identifier}')
     ORDER BY created_at DESC LIMIT 10
  ) x), '[]'::json)
);
""".format(identifier=identifier)
    result = subprocess.run(
        ["docker", "exec", "-i", "workspace-agent-paperclip-db-1", "sh", "-c",
         'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -P pager=off'],
        input=sql, capture_output=True, text=True, timeout=25, check=False)
    if result.returncode:
        raise SystemExit("Paperclip database query failed; details withheld")
    try:
        data = json.loads(result.stdout.strip())
    except (ValueError, TypeError):
        raise SystemExit("Unexpected database response; details withheld")
    issue = data.get("issue")
    if not issue:
        raise SystemExit("Issue not found")
    runs = data.get("runs") or []
    print("Issue:", issue["identifier"], "status:", issue["status"])
    print("Current execution lock:", bool(issue.get("execution_run_id")),
          "checkout lock:", bool(issue.get("checkout_run_id")))
    for entry in runs:
        matches = entry["id"] in (issue.get("execution_run_id"), issue.get("checkout_run_id"))
        identity = entry["agent_id"] == issue.get("assignee_agent_id") and entry["company_id"] == issue.get("company_id")
        context = issue["id"] in (entry.get("issue_id"), entry.get("context_issue_id"), entry.get("context_task_id"))
        eligible_now = entry["status"] == "running" and issue["status"] == "in_progress" and matches and identity and context
        print("Run:", entry["id"], "status:", entry["status"],
              "identity_matches:", identity, "context_matches:", context,
              "lock_matches_now:", matches, "eligible_now:", eligible_now)
    print("NOTE: This is a CURRENT-state snapshot. Finished runs can legitimately have cleared locks.")
    print("NOTE: An HTTP 200 or succeeded heartbeat does not prove any Scout read succeeded.")
    print("No capabilities, environment variables, task text or secrets are displayed.")

if __name__ == "__main__":
    main()
