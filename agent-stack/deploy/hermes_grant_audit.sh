#!/usr/bin/env bash
# Non-mutating signed-grant and gateway audit for Hermes.
set -Eeuo pipefail
umask 077
OUT="/tmp/hermes-grant-audit-$(date -u +%Y%m%dT%H%M%SZ).txt"
{
 echo "HERMES GRANT AUDIT"
 echo "UTC $(date -u +%FT%TZ)"
 names=(workspace-agent-hermes-paperclip-bridge-1 workspace-agent-task-control-1 workspace-agent-hermes-runtime-1 workspace-agent-three-tool-read-1 workspace-agent-scout-start-gateway-1 multi-mail-crm-tool-gateway-1)
 for name in "${names[@]}"; do
  echo "-- $name --"
  docker inspect -f 'status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$name" 2>/dev/null || echo "not found"
 done
 echo "SIGNING KEY INTEGRITY (no key data)"
 getkey() {
   docker exec "$1" sha256sum /run/secrets/task-capability.key 2>/dev/null | awk '{print $1}' || true
 }
 b=$(getkey workspace-agent-hermes-paperclip-bridge-1)
 c=$(getkey workspace-agent-task-control-1)
 echo "bridge_key_present=$([ -n "$b" ] && echo true || echo false)"
 echo "controller_key_present=$([ -n "$c" ] && echo true || echo false)"
 echo "signing_keys_match=$([ -n "$b" ] && [ "$b" = "$c" ] && echo true || echo false)"
 echo "SOURCE VERSION"
 host=/srv/hermes-stack/deployment-source/agent-stack
 for f in hermes_gateway_bridge.py task_capability.py task_control_policy.mjs task_runtime_context.py; do
  test -f "$host/$f" && printf '%s %s\n' "$f" "$(sha256sum "$host/$f"|awk '{print substr($1,1,16)}')" || echo "$f missing"
 done
 echo "LATEST CONTROLLER ERROR CODES (no payloads)"
 docker logs --since 2h workspace-agent-task-control-1 2>&1 | python3 -c '
import sys,json,collections
counts=collections.Counter()
stages=collections.Counter()
for raw in sys.stdin:
 try: v=json.loads(raw)
 except (ValueError,TypeError):continue
 if isinstance(v,dict) and v.get("event")=="task_control_refused":
  counts[str(v.get("code","unknown"))]+=1
  stages[str(v.get("stage","unknown"))]+=1
print("codes",json.dumps(counts,sort_keys=True))
print("stages",json.dumps(stages,sort_keys=True))
'
 echo "CHECK END"
} >"$OUT"
chmod 600 "$OUT"
cat "$OUT"
