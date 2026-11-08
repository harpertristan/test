#!/usr/bin/env bash
# One-command, task-scoped read of Scout, registration assistant, and email content.
# Does not grant sending, deleting, updating mail, arbitrary internet, or secrets.
set -Eeuo pipefail
umask 077
SCOPE=/srv/hermes-stack/private/three-tool-scope.json
ISSUE_ID=2d95562b-a3f8-465e-bfa9-842dbd950acb
ISSUE_KEY=WOR-7
[[ "$EUID" -eq 0 && -f "$SCOPE" ]] || { echo "Run with sudo on play-scout VM" >&2; exit 2; }
for cmd in python3 docker install; do command -v "$cmd" >/dev/null || exit 2; done
BACKUP="/srv/hermes-stack/backups/scope-WOR-7-$(date -u +%Y%m%d-%H%M%S)-$$.json"
mkdir -p "$(dirname "$BACKUP")"
install -m 0600 "$SCOPE" "$BACKUP"
echo "=== BACKUP ==="
echo "$BACKUP"
python3 - "$SCOPE" "$ISSUE_ID" "$ISSUE_KEY" <<'PY'
import json,sys,os
scope_path,issue_id,issue_key=sys.argv[1:]
with open(scope_path) as f: scope=json.load(f)
assert scope.get("version")==1 and isinstance(scope.get("grants"),dict),"Unexpected policy"
grant=scope["grants"].get(issue_id)
assert isinstance(grant,dict) and grant.get("issueIdentifier")==issue_key,"Issue grant mismatch"
assert grant.get("workspaceWide") is True,"Existing workspace-wide consent required"
assert isinstance(grant.get("operations"),list),"Invalid operations list"
approved={
 "scout_candidates","scout_findings","scout_monitor","scout_active",
 "assistant_companies","mail_tasks","mail_companies","mail_messages","mail_message"
}
# Keep sensitive registration/company details outside the initial scope.
denied={
 "assistant_profile","assistant_facts","assistant_review","assistant_extracted"
}
before=set(grant["operations"])
grant["operations"]=sorted((before-denied)|approved)
# User explicitly authorized reading mail bodies to analyze and notify; no send operation.
grant["mailConsent"]=True
# Mount is a file bind: update the same inode, not os.replace() (device busy / stale inode).
serialized=json.dumps(scope,ensure_ascii=False,indent=2)+"\n"
with open(scope_path,"w") as f:
 f.write(serialized)
 f.flush()
 os.fsync(f.fileno())
print("WOR-7 read permissions:",", ".join(sorted(approved)))
print("Mail messages and message bodies: READ-ONLY.")
print("Registration company-specific details: DENIED pending company scope.")
print("No network, shell, URL, secret, SMTP send, or write permission granted.")
PY
chown 10000:10000 "$SCOPE"
chmod 0400 "$SCOPE"
echo "=== VERIFY CONFIG ==="
python3 - "$SCOPE" "$ISSUE_ID" <<'PY'
import json,sys
s=json.load(open(sys.argv[1]))
g=s["grants"][sys.argv[2]]
assert g["mailConsent"] is True
assert {"mail_tasks","mail_companies","mail_messages","mail_message","scout_findings","assistant_companies"}.issubset(g["operations"])
assert not set(g["operations"]) & {"assistant_profile","assistant_facts","assistant_review","assistant_extracted"}
print("Permission validation: PASS")
PY
echo "=== CONTAINER STATE (READ ONLY) ==="
for name in workspace-agent-hermes-runtime-1 workspace-agent-three-tool-read-1 workspace-agent-task-control-1 workspace-agent-scout-start-gateway-1; do
 docker inspect --format '{{.Name}}: {{.State.Status}}' "$name" 2>/dev/null || true
done
echo "=== SUCCESS: SCOPED THREE-SERVICE READ INCLUDING MAIL CONTENT ENABLED ==="
echo "Important: no Paperclip status changed, and no new active run created."
echo "Existing unauthorized task/run requests will still be refused."
