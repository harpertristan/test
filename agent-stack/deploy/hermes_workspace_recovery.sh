#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ROOT=/srv/hermes-stack
BASE="$ROOT/deployment-source/agent-stack"
cd "$ROOT/deployment-source"
test "$(id -u)" -eq 0 || { echo "sudo required"; exit 1; }
git remote get-url origin | grep -Eq 'harpertristan/test([.]git)?$'
RELEASE=b955ae6e675e66208564e274d99be5eb083ca265
git cat-file -e "$RELEASE^{commit}"
C=(docker compose -p workspace-agent
  -f "$BASE/compose.yaml"
  -f "$BASE/compose.paperclip.yaml"
  -f "$BASE/compose.hermes-gateway.yaml"
  -f "$BASE/compose.task-control.yaml"
  -f "$BASE/compose.three-tools.yaml"
  -f "$BASE/compose.scout-start.yaml"
  -f "$BASE/compose.developer-workspace.yaml")
"${C[@]}" config --quiet || { echo "SAFE STOP: compose invalid"; exit 1; }
for dir in "$ROOT/developer-tools" "$ROOT/state/developer-workspace"; do
  test ! -L "$dir" || { echo "Unsafe symlink: $dir"; exit 1; }
  mkdir -p "$dir"
  chown 10000:10000 "$dir"
  chmod 700 "$dir"
done
BACKUP="$ROOT/backups/hermes-dev-recovery-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP"
chmod 700 "$BACKUP"
docker inspect workspace-agent-hermes-runtime-1 --format '{{range .Mounts}}{{println .Destination}}{{end}}' > "$BACKUP/previous-runtime-mounts.txt"
echo "STARTING DEVELOPER WORKSPACE"
"${C[@]}" up -d --no-deps --wait --wait-timeout 160 developer-workspace
docker inspect workspace-agent-developer-workspace-1 --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' | grep -qx healthy
echo "ATTACHING DEVELOPER WORKSPACE TO HERMES"
"${C[@]}" up -d --no-deps --wait --wait-timeout 180 hermes-runtime
for mount in /run/dev-tools /run/three-tools /run/task-control /run/model-bridge; do
  docker inspect workspace-agent-hermes-runtime-1 --format '{{range .Mounts}}{{println .Destination}}{{end}}' | grep -qx "$mount" || { echo "Missing runtime mount: $mount"; exit 1; }
done
docker exec workspace-agent-hermes-runtime-1 /opt/hermes/.venv/bin/python -c 'import os; assert os.path.exists("/run/dev-tools/workspace.sock")'
git show "$RELEASE:agent-stack/deploy/hermes_project_intelligence_upgrade.sh" > "$BACKUP/upgrade.sh"
bash -n "$BACKUP/upgrade.sh"
bash "$BACKUP/upgrade.sh"
echo "HERMES DEVELOPER WORKSPACE AND INTENT UPGRADE COMPLETE"
echo "BACKUP: $BACKUP"
