#!/usr/bin/env bash
# Enable task-scoped, read-only analysis of 3 systems. No unrestricted network or external writes.
set -Eeuo pipefail
umask 077
SCOPE=/srv/hermes-stack/private/three-tool-scope.json
ISSUE_ID=2d95562b-a3f8-465e-bfa9-842dbd950acb
ISSUE_KEY=WOR-7
[[ "$EUID" == 0 && -f "$SCOPE" ]] || { echo "Run via sudo on existing Hermes VM" >&2;exit 2; }
BACKUP="/srv/hermes-stack/backups/scope-WOR-7-$(date -u +%Y%m%d-%H%M%S)-$$.json"
install -m 0600 "$SCOPE" "$BACKUP"
python3 - "$SCOPE" "$ISSUE_ID" "$ISSUE_KEY" <<'PY'
import json,os,sys
scope_path,issue_id,issue_key=sys.argv[1:]
scope=json.load(open(scope_path))
assert scope.get("version")==1 and isinstance(scope.get("grants"),dict),"Unexpected policy"
grant=scope["grants"].get(issue_id)
assert isinstance(grant,dict) and grant.get("issueIdentifier")==issue_key,"Issue grant mismatch"
assert grant.get("workspaceWide") is True,"Explicit existing workspace-wide consent required"
assert isinstance(grant.get("operations"),list),"Invalid operations"
# Scope is read-only; no mail message body and no outbound send/change operations.
approved={
 "scout_candidates","scout_findings","scout_monitor","scout_active",
 "assistant_companies",
 "mail_tasks","mail_companies"
}
grant["operations"]=sorted(set(grant["operations"])|approved)
# Do not change mailConsent; mail message bodies require separate approval.
tmp=scope_path+".new"
with open(tmp,"w") as f:
 os.chmod(tmp,0o400)
 json.dump(scope,f,ensure_ascii=False,indent=2)
 f.write("\n")
os.replace(tmp,scope_path)
print("Allowed read-only metadata:",", ".join(sorted(approved)))
print("Mail message body consent unchanged.")
print("No network, shell, arbitrary URL, SMTP send or configuration write access added.")
PY
chown 10000:10000 "$SCOPE"
chmod 0400 "$SCOPE"
echo "=== AUTHORIZATION FILE UPDATED ==="
echo "Backup: $BACKUP"
echo "NOTE: active Paperclip task/run policy is mandatory; in_review runs still refused."
