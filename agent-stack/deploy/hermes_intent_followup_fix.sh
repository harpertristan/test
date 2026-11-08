#!/usr/bin/env bash
# Scoped remediation for user-intent regression and Scout public-site provenance.
set -Eeuo pipefail
umask 077
ROOT=/srv/hermes-stack
WORK="$ROOT/deployment-source"
BASE="$WORK/agent-stack"
B="$BASE/hermes_gateway_bridge.py"
T="$BASE/scout_crm_source_trust.mjs"
REF=f81e7f40bde572d0b6fc7d82fca00192db82255e
SCOUT=workspace-agent-scout-start-gateway-1
BRIDGE=workspace-agent-hermes-paperclip-bridge-1
BACKUP="$ROOT/backups/hermes-intent-followup-$(date -u +%Y%m%dT%H%M%SZ)"
test "$(id -u)" = 0 || { echo "sudo required"; exit 1; }
for f in "$B" "$T"; do test -f "$f" && test ! -L "$f" || { echo "Unsafe file: $f"; exit 1; }; done
cd "$WORK"
git remote get-url origin | grep -Eq 'harpertristan/test([.]git)?$' || { echo "Unexpected origin"; exit 1; }
git cat-file -e "$REF^{commit}"
mkdir -p "$BACKUP/stage/tests"
cp -p "$B" "$BACKUP/hermes_gateway_bridge.py"
cp -p "$T" "$BACKUP/scout_crm_source_trust.mjs"
STAGE="$BACKUP/stage"
git show "$REF:agent-stack/hermes_gateway_bridge.py" > "$STAGE/reviewed_bridge.py"
git show "$REF:agent-stack/scout_crm_source_trust.mjs" > "$STAGE/reviewed_trust.mjs"
git show "$REF:agent-stack/tests/scout_crm_source_trust.test.mjs" > "$STAGE/tests/scout_crm_source_trust.test.mjs"
cp -p "$BASE/scout_web_policy.mjs" "$STAGE/scout_web_policy.mjs"
cp -p "$BASE/active_run_scope.mjs" "$STAGE/active_run_scope.mjs"
cp -p "$B" "$STAGE/hermes_gateway_bridge.py"
cp -p "$T" "$STAGE/scout_crm_source_trust.mjs"
python3 - "$STAGE" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
a=(p/"hermes_gateway_bridge.py").read_text()
b=(p/"reviewed_bridge.py").read_text()
marker='    "КРИТИЧЕСКОЕ ПРАВИЛО: сначала ответь именно на ПОСЛЕДНИЙ вопрос пользователя. "'
boundary='    "РЕЖИМ ОСМЫСЛЕННОГО ИСПОЛНЕНИЯ:'
if marker not in a:
  if b.count(marker)!=1 or b.count(boundary)!=1 or a.count(boundary)!=1:
    raise SystemExit("SAFE STOP: chat source mismatch")
  fragment=b[b.index(marker):b.index(boundary)]
  a=a.replace(boundary,fragment+boundary,1)
  (p/"hermes_gateway_bridge.py").write_text(a)
old='row.developerWebsite, row.url,'
new='row.developerWebsite, row.url, row.website,'
s=(p/"scout_crm_source_trust.mjs").read_text()
if new not in s:
  if s.count(old)!=1:
    raise SystemExit("SAFE STOP: CRM trust source mismatch")
  s=s.replace(old,new,1)
  (p/"scout_crm_source_trust.mjs").write_text(s)
print("Intent and CRM website fixes staged.")
PY
python3 -m py_compile "$STAGE/hermes_gateway_bridge.py"
docker run --rm --network none --read-only --cap-drop ALL \
 --security-opt no-new-privileges -v "$STAGE:/work:ro" \
 --entrypoint node workspace-paperclip:7e3caa7 \
 --test /work/tests/scout_crm_source_trust.test.mjs
echo "STAGED TESTS PASS"
ACTIVE=0
rollback() {
  trap - ERR
  if [ "$ACTIVE" -eq 1 ]; then
    echo "Deployment failed; restoring source files."
    cp -p "$BACKUP/hermes_gateway_bridge.py" "$B" || true
    cp -p "$BACKUP/scout_crm_source_trust.mjs" "$T" || true
    docker restart "$SCOUT" "$BRIDGE" >/dev/null || true
  fi
}
trap rollback ERR
ACTIVE=1
cp -p "$STAGE/hermes_gateway_bridge.py" "$B"
cp -p "$STAGE/scout_crm_source_trust.mjs" "$T"
docker restart "$SCOUT" "$BRIDGE" >/dev/null
ok=0
for _ in $(seq 1 30); do
 scouthealth=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$SCOUT")
 bridgerunning=$(docker inspect -f '{{.State.Running}}' "$BRIDGE")
 if [ "$scouthealth" = healthy ] && [ "$bridgerunning" = true ]; then ok=1; break; fi
 sleep 5
done
[ "$ok" = 1 ] || { echo "Health check failed"; false; }
ACTIVE=0
trap - ERR
echo "HERMES INTENT FIX INSTALLED; SCOUT HEALTHY; BRIDGE RUNNING"
echo "BACKUP: $BACKUP"
echo "No CRM state, mail messages, or production permissions changed."
