#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ROOT=/srv/hermes-stack
WORK="$ROOT/deployment-source"
BASE="$WORK/agent-stack"
SOURCE="$BASE/model_proxy.py"
SERVICE=workspace-agent-model-proxy-1
BACKUP="$ROOT/backups/hermes-model-queue-diagnostic-$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE=ac0d6f9a1ceebc4f04b0c4f1ab2b8cc517220cd2

test "$(id -u)" -eq 0 || { echo "Run with sudo"; exit 1; }
test -f "$SOURCE" && test ! -L "$SOURCE" || { echo "Unsafe source file"; exit 1; }
cd "$WORK"
git remote get-url origin | grep -Eq 'harpertristan/test([.]git)?$' || { echo "Wrong Git origin"; exit 1; }
git cat-file -e "$RELEASE^{commit}"
mkdir -p "$BACKUP/stage/tests"
chmod 700 "$BACKUP" "$BACKUP/stage"
cp -p "$SOURCE" "$BACKUP/model_proxy.py"

status() {
 docker inspect "$SERVICE" --format 'state={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} exit={{.State.ExitCode}} restarts={{.RestartCount}}' 2>&1 || true
}
health() {
 docker inspect "$SERVICE" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null || echo missing
}
diagnostics() {
 echo "--- MODEL PROXY STATE ---"
 status
 echo "--- HEALTHCHECK DETAILS ---"
 docker inspect "$SERVICE" --format '{{if .State.Health}}{{range .State.Health.Log}}{{printf "exit=%d output=%q\n" .ExitCode .Output}}{{end}}{{end}}' 2>/dev/null | tail -8 || true
 echo "--- REDACTED RECENT LOGS ---"
 docker logs --tail 65 "$SERVICE" 2>&1 |
 sed -E -e 's/(Bearer )[A-Za-z0-9._~+\/-]+/\1[REDACTED]/Ig'  -e 's/sk-[A-Za-z0-9_-]{12,}/[REDACTED]/g'  -e 's/((api[_-]?key|token|password|secret)[[:space:]]*[:=][[:space:]]*)[^[:space:],]+/\1[REDACTED]/Ig' | tail -65 || true
 echo "--- END DIAGNOSTICS ---"
}
echo "=== PRECHECK ==="
status
if [ "$(health)" != healthy ]; then
 echo "BASELINE MODEL PROXY IS NOT HEALTHY. No code changes will be attempted."
 diagnostics
 exit 20
fi
echo "=== PREPARE PATCH ==="
git show "$RELEASE:agent-stack/model_proxy.py" > "$BACKUP/stage/reviewed_model_proxy.py"
git show "$RELEASE:agent-stack/tests/test_model_queue.py" > "$BACKUP/stage/tests/test_model_queue.py"
python3 - "$SOURCE" "$BACKUP/stage/model_proxy.py" "$BACKUP/stage/reviewed_model_proxy.py" <<'PY'
from pathlib import Path
import sys
src=Path(sys.argv[1]).read_text()
ref=Path(sys.argv[3]).read_text()
if 'self.queue = threading.BoundedSemaphore(32)' in src:
    raise SystemExit("Queue patch already in source; not applying twice.")
old='        self.active = threading.BoundedSemaphore(2)\n'
anchor='    def allowed(self, input_bytes=0):\n'
gate='        if not self.server.allowed(size) or not self.server.active.acquire(\n'
end='        finally:\n            self.server.active.release()\n'
if any(src.count(x)!=1 for x in (old,anchor,gate,end)):
    raise SystemExit("SAFE STOP: source differs; no changes made")
helper=ref[ref.index('    def wait_for_rate_slot('):ref.index(anchor)]
start=src.index(gate)
stop=src.index('            request = urllib.request.Request(',start)
new=ref[ref.index('        # Queue limited bursts'):ref.index('            request = urllib.request.Request(')]
src=src.replace(old,old+'        self.queue = threading.BoundedSemaphore(32)\n',1)
src=src.replace(anchor,helper+anchor,1)
start=src.index(gate);stop=src.index('            request = urllib.request.Request(',start)
src=src[:start]+new+src[stop:]
src=src.replace(end,'        finally:\n            if acquired:\n                self.server.active.release()\n            self.server.queue.release()\n',1)
Path(sys.argv[2]).write_text(src)
PY
PYTHONDONTWRITEBYTECODE=1 python3 -m py_compile "$BACKUP/stage/model_proxy.py"
(cd "$BACKUP/stage" && PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p test_model_queue.py -v)
echo "=== INSTALL ==="
changed=0
restore() {
 code=$?
 trap - ERR
 if [ "$changed" = 1 ]; then
  echo "RESTORING ORIGINAL MODEL PROXY"
  cp -p "$BACKUP/model_proxy.py" "$SOURCE" || true
  docker restart "$SERVICE" >/dev/null || true
  for _ in $(seq 1 20); do [ "$(health)" = healthy ] && break; sleep 3; done
  diagnostics
 fi
 echo "BACKUP: $BACKUP"
 exit "$code"
}
trap restore ERR
cp -p "$BACKUP/stage/model_proxy.py" "$SOURCE"
changed=1
docker restart "$SERVICE" >/dev/null
healthy=0
for _ in $(seq 1 36); do
 h=$(health)
 if [ "$h" = healthy ]; then healthy=1; break; fi
 if [ "$h" = unhealthy ]; then break; fi
 sleep 4
done
if [ "$healthy" != 1 ]; then
 echo "UPDATED SERVICE FAILED HEALTHCHECK"
 diagnostics
 false
fi
changed=0
trap - ERR
echo "HERMES MODEL QUEUE INSTALLED; HEALTHY"
echo "BACKUP: $BACKUP"
echo "No quota, API key, production permissions, or model change."
