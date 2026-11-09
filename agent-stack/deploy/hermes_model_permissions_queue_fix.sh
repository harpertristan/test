#!/usr/bin/env bash
# Repair model-proxy source readability for Docker UID 10000, then install bounded queue.
# Single operation, no changes to credentials, quotas, other services or approvals.
set -Eeuo pipefail
umask 077
ROOT=/srv/hermes-stack
WORK="$ROOT/deployment-source"
BASE="$WORK/agent-stack"
SOURCE="$BASE/model_proxy.py"
SERVICE=workspace-agent-model-proxy-1
RELEASE=ac0d6f9a1ceebc4f04b0c4f1ab2b8cc517220cd2
BACKUP="$ROOT/backups/hermes-model-permission-queue-$(date -u +%Y%m%dT%H%M%SZ)"
test "$(id -u)" -eq 0 || { echo "ERROR: sudo required"; exit 1; }
test -f "$SOURCE" && test ! -L "$SOURCE" || { echo "ERROR: missing or unsafe source"; exit 1; }
cd "$WORK"
git remote get-url origin | grep -Eq 'harpertristan/test([.]git)?$' || { echo "ERROR: unexpected git remote"; exit 1; }
git cat-file -e "$RELEASE^{commit}" || { echo "ERROR: fetch release branch first"; exit 1; }
docker inspect "$SERVICE" >/dev/null
mkdir -p "$BACKUP/stage/tests"
chmod 700 "$BACKUP" "$BACKUP/stage"
cp -p "$SOURCE" "$BACKUP/original_model_proxy.py"
ORIG_UID=$(stat -c '%u' "$SOURCE")
ORIG_GID=$(stat -c '%g' "$SOURCE")
ORIG_MODE=$(stat -c '%a' "$SOURCE")
echo "BEFORE: $(stat -c '%n uid=%u gid=%g permissions=%a' "$SOURCE")"
git show "$RELEASE:agent-stack/model_proxy.py" > "$BACKUP/stage/reviewed_model_proxy.py"
git show "$RELEASE:agent-stack/tests/test_model_queue.py" > "$BACKUP/stage/tests/test_model_queue.py"

python3 - "$SOURCE" "$BACKUP/stage/model_proxy.py" "$BACKUP/stage/reviewed_model_proxy.py" <<'PY'
from pathlib import Path
import sys
source=Path(sys.argv[1]).read_text()
review=Path(sys.argv[3]).read_text()
if 'self.queue = threading.BoundedSemaphore(32)' in source:
    result=source
    print("Queue already present; only source permissions will be corrected")
else:
    a='        self.active = threading.BoundedSemaphore(2)\n'
    b='    def allowed(self, input_bytes=0):\n'
    c='        if not self.server.allowed(size) or not self.server.active.acquire(\n'
    d='        finally:\n            self.server.active.release()\n'
    if any(source.count(s)!=1 for s in (a,b,c,d)):
        raise SystemExit("SAFE STOP: live gateway code differs, no modifications")
    helper=review[review.index('    def wait_for_rate_slot('):review.index(b)]
    replacement=review[review.index('        # Queue limited bursts'):review.index('            request = urllib.request.Request(')]
    source=source.replace(a,a+'        self.queue = threading.BoundedSemaphore(32)\n',1)
    source=source.replace(b,helper+b,1)
    start=source.index(c)
    stop=source.index('            request = urllib.request.Request(',start)
    source=source[:start]+replacement+source[stop:]
    source=source.replace(d,'        finally:\n            if acquired:\n                self.server.active.release()\n            self.server.queue.release()\n',1)
    result=source
    print("Bounded queue added to existing live code")
Path(sys.argv[2]).write_text(result)
PY
PYTHONDONTWRITEBYTECODE=1 python3 -m py_compile "$BACKUP/stage/model_proxy.py"
(cd "$BACKUP/stage" && PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p test_model_queue.py -v)
echo "TESTS PASSED; STARTING SINGLE-SERVICE REPAIR"

health() {
 docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$SERVICE" 2>/dev/null || echo missing
}
diag() {
 echo "--- SERVICE STATE ---"
 docker inspect "$SERVICE" --format 'status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{end}} restarts={{.RestartCount}}' || true
 echo "--- CURRENT FILE ---"
 stat -c '%n uid=%u gid=%g mode=%a' "$SOURCE" || true
 echo "--- LAST HEALTHCHECK OUTPUT ---"
 docker inspect "$SERVICE" --format '{{if .State.Health}}{{range .State.Health.Log}}{{printf "exit=%d output=%q\n" .ExitCode .Output}}{{end}}{{end}}' 2>/dev/null | tail -5 || true
 echo "--- RECENT ERROR CODES ---"
 docker logs --tail 40 "$SERVICE" 2>&1 | grep -E 'Permission denied|Traceback|No such file|ModuleNotFound|SyntaxError|model_gateway: ready' | tail -15 || true
}
CHANGED=0
rollback() {
 result=$?
 trap - ERR INT TERM
 if [ "$CHANGED" = 1 ]; then
   echo "DEPLOYMENT FAILED: restoring original source AND safe readability"
   cp -p "$BACKUP/original_model_proxy.py" "$SOURCE" || true
   chmod 644 "$SOURCE" || true
   docker restart "$SERVICE" >/dev/null || true
   sleep 5
   diag
 fi
 echo "BACKUP: $BACKUP"
 exit "$result"
}
trap rollback ERR
trap 'exit 130' INT
trap 'exit 143' TERM
CHANGED=1
# UID 10000 in a read-only bind-mount must be able to read the Python source.
# Never chmod the private key or any other source.
install -m 0644 -o "$ORIG_UID" -g "$ORIG_GID" "$BACKUP/stage/model_proxy.py" "$SOURCE"
docker restart "$SERVICE" >/dev/null
READY=0
for _ in $(seq 1 45); do
 if [ "$(health)" = healthy ]; then READY=1; break; fi
 sleep 3
done
if [ "$READY" != 1 ]; then
  echo "GATEWAY DID NOT PASS HEALTHCHECK"
  diag
  false
fi
# Ensure actual container identity can read file, independent of Docker health state.
docker exec --user 10000:10000 "$SERVICE" /opt/hermes/.venv/bin/python -c \
 'from pathlib import Path; p=Path("/opt/workspace-agent/model_proxy.py"); assert p.is_file(); compile(p.read_text(),str(p),"exec"); print("MODEL SOURCE READABLE TO UID 10000")'
CHANGED=0
trap - ERR INT TERM
echo "HERMES MODEL QUEUE AND SOURCE PERMISSIONS FIXED; GATEWAY HEALTHY"
echo "BACKUP: $BACKUP"
echo "No API keys, quotas, production privileges or CRM data changed."
