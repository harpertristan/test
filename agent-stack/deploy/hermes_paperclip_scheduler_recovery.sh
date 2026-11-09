#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ROOT=/srv/hermes-stack
BASE="$ROOT/deployment-source/agent-stack"
FILE="$BASE/compose.paperclip.yaml"
test "$(id -u)" -eq 0 || { echo "sudo required"; exit 1; }
test -f "$FILE" && test ! -L "$FILE" || { echo "SAFE STOP: invalid compose source"; exit 1; }
docker compose version >/dev/null
for name in workspace-agent-paperclip-1 workspace-agent-task-control-1 workspace-agent-hermes-paperclip-bridge-1; do
 docker inspect "$name" >/dev/null || { echo "SAFE STOP: missing $name"; exit 1; }
done
BACKUP="$ROOT/backups/hermes-paperclip-scheduler-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP"
chmod 700 "$BACKUP"
cp -p "$FILE" "$BACKUP/compose.paperclip.yaml"
cd "$ROOT/deployment-source"
C=(docker compose -p workspace-agent
 -f "$BASE/compose.yaml"
 -f "$BASE/compose.paperclip.yaml"
 -f "$BASE/compose.hermes-gateway.yaml"
 -f "$BASE/compose.task-control.yaml"
 -f "$BASE/compose.three-tools.yaml"
 -f "$BASE/compose.scout-start.yaml"
 -f "$BASE/compose.developer-workspace.yaml")
"${C[@]}" config --quiet
python3 - "$FILE" "$BACKUP/patched.yaml" <<'PY'
from pathlib import Path
import sys
src=Path(sys.argv[1]).read_text()
needle="      HEARTBEAT_SCHEDULER_ENABLED: 'false'"
if src.count(needle)!=1:
 raise SystemExit("SAFE STOP: scheduler is not exactly as expected")
Path(sys.argv[2]).write_text(src.replace(needle,"      HEARTBEAT_SCHEDULER_ENABLED: 'true'",1))
PY
for name in workspace-agent-paperclip-1 workspace-agent-task-control-1 workspace-agent-hermes-paperclip-bridge-1; do
 docker inspect "$name" --format '{{.Name}} image={{.Config.Image}} state={{.State.Status}}' >> "$BACKUP/before.txt"
done
CHANGED=0
restore() {
 code=$?
 trap - ERR INT TERM
 if [ "$CHANGED" = 1 ]; then
  echo "INSTALL FAILURE: restoring Compose and Paperclip services"
  cp -p "$BACKUP/compose.paperclip.yaml" "$FILE" || true
  "${C[@]}" up -d --no-deps --force-recreate paperclip task-control hermes-paperclip-bridge || true
 fi
 echo "BACKUP: $BACKUP"
 exit "$code"
}
trap restore ERR
trap 'exit 130' INT
trap 'exit 143' TERM
install -m 0644 -o "$(stat -c %u "$FILE")" -g "$(stat -c %g "$FILE")" "$BACKUP/patched.yaml" "$FILE"
CHANGED=1
"${C[@]}" config --quiet
echo "Recreating Paperclip and namespace-sharing sidecars; no volumes removed"
"${C[@]}" up -d --no-deps --force-recreate paperclip task-control hermes-paperclip-bridge
healthy() {
 local n="$1"
 local v
 v=$(docker inspect "$n" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null) || return 1
 [ "$v" = healthy ] || { [ "$n" = workspace-agent-hermes-paperclip-bridge-1 ] && [ "$v" = running ]; }
}
OK=0
for _ in $(seq 1 50); do
 if healthy workspace-agent-paperclip-1 && healthy workspace-agent-task-control-1 && healthy workspace-agent-hermes-paperclip-bridge-1; then OK=1; break; fi
 sleep 3
done
[ "$OK" = 1 ] || { echo "Paperclip or sidecar failed to become healthy"; false; }
ACTUAL=$(docker inspect workspace-agent-paperclip-1 --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^HEARTBEAT_SCHEDULER_ENABLED=' || true)
[ "$ACTUAL" = 'HEARTBEAT_SCHEDULER_ENABLED=true' ] || { echo "Scheduler setting not applied"; false; }
CHANGED=0
trap - ERR INT TERM
echo "PAPERCLIP SCHEDULER ENABLED; PAPERCLIP AND SIDECARS HEALTHY"
echo "NOTE: Actual task execution not yet confirmed; Paperclip now processes scheduled retries."
echo "BACKUP: $BACKUP"
