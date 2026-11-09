#!/usr/bin/env bash
# Bounded model gateway queue, no quota increases, guarded source patch & rollback.
set -Eeuo pipefail
umask 077
ROOT=/srv/hermes-stack
WORK="$ROOT/deployment-source"
BASE="$WORK/agent-stack"
FILE="$BASE/model_proxy.py"
SERVICE=workspace-agent-model-proxy-1
RELEASE=ac0d6f9a1ceebc4f04b0c4f1ab2b8cc517220cd2
BACKUP="$ROOT/backups/hermes-model-queue-$(date -u +%Y%m%dT%H%M%SZ)"
test "$(id -u)" -eq 0 || { echo "ERROR: sudo required"; exit 1; }
test -f "$FILE" && test ! -L "$FILE" || { echo "ERROR: source unavailable"; exit 1; }
cd "$WORK"
git remote get-url origin | grep -Eq 'harpertristan/test([.]git)?$' || { echo "ERROR: unexpected Git origin"; exit 1; }
git cat-file -e "$RELEASE^{commit}"
mkdir -p "$BACKUP/stage/tests"
chmod 700 "$BACKUP" "$BACKUP/stage"
cp -p "$FILE" "$BACKUP/model_proxy.py"
STAGE="$BACKUP/stage"
git show "$RELEASE:agent-stack/model_proxy.py" > "$STAGE/reviewed_model_proxy.py"
git show "$RELEASE:agent-stack/tests/test_model_queue.py" > "$STAGE/tests/test_model_queue.py"
python3 - "$FILE" "$STAGE/model_proxy.py" "$STAGE/reviewed_model_proxy.py" <<'PY'
from pathlib import Path
import sys
original=Path(sys.argv[1]).read_text()
reference=Path(sys.argv[3]).read_text()
if 'self.queue = threading.BoundedSemaphore(32)' in original:
    raise SystemExit("ALREADY INSTALLED: stop without modifying current gateway")
a='        self.active = threading.BoundedSemaphore(2)\n'
b='    def allowed(self, input_bytes=0):\n'
c='        if not self.server.allowed(size) or not self.server.active.acquire(\n'
d='    def main():'
if original.count(a)!=1 or original.count(b)!=1 or original.count(c)!=1:
    raise SystemExit("SAFE STOP: unrecognized gateway code")
original=original.replace(a,a+'        self.queue = threading.BoundedSemaphore(32)\n',1)
start=reference.index('    def wait_for_rate_slot(')
end=reference.index(b,start)
original=original.replace(b,reference[start:end]+b,1)
start=original.index(c)
end=original.index('            request = urllib.request.Request(',start)
replacement=reference[reference.index('        # Queue limited bursts'):reference.index('            request = urllib.request.Request(')]
original=original[:start]+replacement+original[end:]
old='        finally:\n            self.server.active.release()\n'
new='        finally:\n            if acquired:\n                self.server.active.release()\n            self.server.queue.release()\n'
if original.count(old)!=1:raise SystemExit("SAFE STOP: release block differs")
original=original.replace(old,new,1)
Path(sys.argv[2]).write_text(original)
print("MODEL QUEUE PATCH STAGED")
PY
PYTHONDONTWRITEBYTECODE=1 python3 -m py_compile "$STAGE/model_proxy.py"
(cd "$STAGE" && PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p test_model_queue.py -v)
echo "MODEL QUEUE TESTS PASSED"
rollback() {
  trap - ERR
  echo "ERROR: model gateway verification failed; restoring source"
  cp -p "$BACKUP/model_proxy.py" "$FILE" || true
  docker restart "$SERVICE" >/dev/null || true
}
trap rollback ERR
cp -p "$STAGE/model_proxy.py" "$FILE"
docker restart "$SERVICE" >/dev/null
ok=0
for _ in $(seq 1 30); do
 health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$SERVICE")
 if [ "$health" = healthy ]; then ok=1; break; fi
 sleep 4
done
[ "$ok" -eq 1 ] || { echo "ERROR: model gateway unhealthy"; false; }
trap - ERR
echo "HERMES MODEL QUEUE FIX INSTALLED; GATEWAY HEALTHY"
echo "BACKUP: $BACKUP"
echo "Daily quota, permitted models, approvals and existing task data unchanged."
