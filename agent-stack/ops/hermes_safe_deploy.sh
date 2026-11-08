#!/usr/bin/env bash
# Safe, single-command Hermes rollout. No Scout jobs, database writes or auth bypasses.
set -Eeuo pipefail
umask 077

ROOT="/srv/hermes-stack/deployment-source"
BASE="$ROOT/agent-stack"
BRANCH="test-hermes-scout-flow-20261108"
RUNTIME="workspace-agent-hermes-runtime-1"
BRIDGE="workspace-agent-hermes-paperclip-bridge-1"
READ="workspace-agent-three-tool-read-1"
CONTROL="workspace-agent-task-control-1"
SCOUT="play-scout-app-1"
FILES=(task_runtime_context.py hermes_gateway_bridge.py)
MODE="${1:---apply}"
if [[ "$MODE" != "--apply" && "$MODE" != "--check" ]]; then
  echo "Usage: bash hermes_safe_deploy.sh [--apply|--check]" >&2; exit 2
fi
if [[ "$EUID" -ne 0 ]]; then
  echo "Run with sudo. This script backs up the old files first." >&2; exit 2
fi
for tool in git docker python3 mktemp install cmp tar; do
  command -v "$tool" >/dev/null || { echo "Missing executable: $tool" >&2; exit 2; }
done
[[ -d "$ROOT/.git" && -f "$BASE/task_runtime_context.py" ]] || {
  echo "Unexpected deployment layout; no changes made." >&2; exit 2;
}
for name in "$RUNTIME" "$BRIDGE" "$READ" "$CONTROL"; do
  docker inspect "$name" >/dev/null || { echo "Missing container $name" >&2; exit 2; }
done
STAGE="$(mktemp -d /tmp/hermes-rollout.XXXXXXXX)"
BACKUP=""
CHANGED=0
ROLLED_BACK=0
cleanup() { rm -rf "$STAGE"; }
rollback() {
  if [[ "$CHANGED" -eq 1 && -n "$BACKUP" && "$ROLLED_BACK" -eq 0 ]]; then
    ROLLED_BACK=1
    echo "ROLLBACK: restoring source files from $BACKUP" >&2
    for file in "${FILES[@]}"; do
      install -m 0644 "$BACKUP/$file" "$BASE/$file" || true
    done
    docker restart "$RUNTIME" "$BRIDGE" >/dev/null || true
  fi
}
on_error() {
  local code="$?"
  trap - ERR
  rollback
  echo "ERROR: deployment verification failed (exit=$code). Backup retained: ${BACKUP:-none}" >&2
  exit "$code"
}
trap cleanup EXIT
trap on_error ERR

echo "=== EXTRACT APPROVED FILES ($BRANCH) ==="
# FETCH_HEAD was fetched by the calling non-root user. Never alter repo ownership.
REF="$(git -c safe.directory="$ROOT" -C "$ROOT" rev-parse FETCH_HEAD)"
echo "Commit: $REF"
mkdir -p "$STAGE/agent-stack"
for file in "${FILES[@]}"; do
  git -c safe.directory="$ROOT" -C "$ROOT" show "$REF:agent-stack/$file" > "$STAGE/agent-stack/$file"
done
# Unpack source code for offline regression tests; no scripts are run from network.
git -c safe.directory="$ROOT" -C "$ROOT" archive "$REF" agent-stack | tar -x -C "$STAGE"
export PYTHONDONTWRITEBYTECODE=1
python3 -m py_compile "$STAGE/agent-stack/task_runtime_context.py" "$STAGE/agent-stack/hermes_gateway_bridge.py"
echo "=== OFFLINE PYTHON REGRESSION TESTS ==="
(cd "$STAGE/agent-stack" && python3 -m unittest discover -s tests -p test_task_read_gate.py -v)
(cd "$STAGE/agent-stack" && python3 -m unittest discover -s tests -p test_scoped_mcp_contract.py -v)
echo "=== OFFLINE JAVASCRIPT REGRESSION TESTS ==="
# Use already-local pinned Node image; never pull or enable a network connection.
if docker image inspect workspace-paperclip:7e3caa7 >/dev/null 2>&1; then
  docker run --rm --network none --read-only \
    -v "$STAGE/agent-stack:/work:ro" -w /work \
    --entrypoint node workspace-paperclip:7e3caa7 --test \
    tests/task_control_policy.test.mjs \
    tests/three_tool_read_scope.test.mjs \
    tests/hermes_scout_contract.test.mjs
elif command -v node >/dev/null 2>&1; then
  (cd "$STAGE/agent-stack" && node --test \
    tests/task_control_policy.test.mjs tests/three_tool_read_scope.test.mjs \
    tests/hermes_scout_contract.test.mjs)
else
  echo "No local Node runner. Refusing an untested rollout." >&2
  exit 2
fi
echo "=== CURRENT SERVICES ==="
for name in "$RUNTIME" "$BRIDGE" "$READ" "$CONTROL"; do
  docker inspect -f '{{.Name}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$name"
done
if [[ "$MODE" == "--check" ]]; then
  echo "CHECK ONLY: no files or containers changed."
  exit 0
fi
echo "=== BACKUP ==="
BACKUP="/srv/hermes-stack/backups/hermes-rollout-$(date -u +%Y%m%d-%H%M%S)-$$"
mkdir -p "$BACKUP"
for file in "${FILES[@]}"; do
  cp -p "$BASE/$file" "$BACKUP/$file"
done
printf 'branch=%s\ncommit=%s\n' "$BRANCH" "$REF" > "$BACKUP/manifest.txt"
echo "Backup: $BACKUP"
echo "=== APPLY ==="
for file in "${FILES[@]}"; do
  if ! cmp -s "$BASE/$file" "$STAGE/agent-stack/$file"; then
    # Flag before changing the first file, so a partial change triggers rollback.
    CHANGED=1
    install -m 0644 "$STAGE/agent-stack/$file" "$BASE/$file"
    echo "Updated $file"
  else
    echo "Unchanged $file"
  fi
done
if [[ "$CHANGED" -eq 1 ]]; then
  echo "Restarting ONLY Hermes runtime and bridge"
  docker restart "$RUNTIME" "$BRIDGE" >/dev/null
else
  echo "Files already match. No restart needed."
fi
echo "=== VERIFY HEALTH ==="
check_health() {
  local state health
  state="$(docker inspect -f '{{.State.Status}}' "$1")"
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$1")"
  [[ "$state" == "running" ]] || return 1
  if [[ "$2" == "required" ]]; then [[ "$health" == "healthy" ]]; fi
}
verified=0
for attempt in {1..24}; do
  if check_health "$RUNTIME" required && check_health "$BRIDGE" optional && \
     check_health "$READ" required && check_health "$CONTROL" required; then
    verified=1
    break
  fi
  sleep 5
done
[[ "$verified" -eq 1 ]] || { echo "Health checks failed; rolling back." >&2; false; }
# Ensure task controllers and read service were not re-created and no production task was touched.
echo "=== SCOUT READ-ONLY STATUS ==="
if docker inspect "$SCOUT" >/dev/null 2>&1; then
  docker inspect -f '{{.Name}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$SCOUT"
else
  echo "Scout container not found; manual integration check still required."
fi
echo "=== FINAL STATUS ==="
for name in "$RUNTIME" "$BRIDGE" "$READ" "$CONTROL"; do
  docker inspect -f '{{.Name}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}} restarts={{.RestartCount}}' "$name"
done
CHANGED=0
echo "SUCCESS: files verified, targeted services running. Backup: $BACKUP"
echo "NOTE: This validates code and service health. It does NOT start Scout discovery or prove a live Paperclip task has permission."
