#!/usr/bin/env bash
# Unified Play Scout source-awareness + intent router deployment for Hermes.
# No production code changes in Play Scout; only the Hermes bridge, and an
# isolated read-only source snapshot for the already-existing Developer Workspace.
set -Eeuo pipefail
umask 077
ROOT=/srv/hermes-stack
WORK="$ROOT/deployment-source"
BASE="$WORK/agent-stack"
BRIDGE="$BASE/hermes_gateway_bridge.py"
ROUTER="$BASE/hermes_intent_router.py"
SCOPE="$ROOT/private/three-tool-scope.json"
IDENTITY="$ROOT/private/task-control.json"
BRIDGE_SERVICE=workspace-agent-hermes-paperclip-bridge-1
DEV_SERVICE=workspace-agent-developer-workspace-1
RELEASE=d8d3836ef1b816585a029e027f171e9c724d891b
BACKUP="$ROOT/backups/hermes-project-intelligence-$(date -u +%Y%m%dT%H%M%SZ)"
test "$(id -u)" = 0 || { echo "ERROR: sudo required"; exit 1; }
cd "$WORK"
git remote get-url origin | grep -Eq 'harpertristan/test([.]git)?$' || { echo "ERROR: unexpected GitHub origin"; exit 1; }
git cat-file -e "$RELEASE^{commit}"
for f in "$BRIDGE" "$SCOPE" "$IDENTITY"; do
  test -f "$f" && test ! -L "$f" || { echo "ERROR: file missing or symlinked $f"; exit 1; }
done
mkdir -p "$BACKUP/stage/tests"
chmod 700 "$BACKUP" "$BACKUP/stage"
STAGE="$BACKUP/stage"
cp -p "$BRIDGE" "$BACKUP/hermes_gateway_bridge.py"
cp -p "$SCOPE" "$BACKUP/three-tool-scope.json"
test ! -e "$ROUTER" || cp -p "$ROUTER" "$BACKUP/hermes_intent_router.py"
cp -p "$BRIDGE" "$STAGE/hermes_gateway_bridge.py"
git show "$RELEASE:agent-stack/hermes_intent_router.py" > "$STAGE/hermes_intent_router.py"
git show "$RELEASE:agent-stack/tests/test_hermes_intent_router.py" > "$STAGE/tests/test_hermes_intent_router.py"
PYTHONDONTWRITEBYTECODE=1 python3 - "$STAGE/hermes_gateway_bridge.py" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
s=p.read_text()
imp="from hermes_intent_router import intent_guide\n"
if imp not in s:
    anchor="import socketserver\n"
    if s.count(anchor)!=1: raise SystemExit("SAFE STOP: bridge import anchor missing")
    s=s.replace(anchor,anchor+imp,1)
old='def build_chat_instructions(original, capability):'
new='def build_chat_instructions(original, capability, user_message=""):'
if new not in s:
    if s.count(old)!=1: raise SystemExit("SAFE STOP: bridge chat builder differs")
    s=s.replace(old,new,1)
old='return (original + CHAT_INSTRUCTIONS\n            + "[[workspace-task-grant:" + capability + "]]")'
new='return (original + CHAT_INSTRUCTIONS + intent_guide(user_message)\n            + "[[workspace-task-grant:" + capability + "]]")'
if new not in s:
    if s.count(old)!=1: raise SystemExit("SAFE STOP: chat return differs")
    s=s.replace(old,new,1)
old='payload.get("instructions", ""), capability\n                        )'
new='payload.get("instructions", ""), capability,\n                            payload.get("input", "")\n                        )'
if new not in s:
    if s.count(old)!=1: raise SystemExit("SAFE STOP: bridge argument site differs")
    s=s.replace(old,new,1)
old='payload["instructions"] = payload.get("instructions", "") + (\n'
new='payload["instructions"] = (payload.get("instructions", "") +\n                            intent_guide(payload.get("input", "")) + (\n'
if new not in s:
    if s.count(old)!=1: raise SystemExit("SAFE STOP: task routing differs")
    s=s.replace(old,new,1)
old='                        "[[workspace-task-grant:" + capability + "]]"\n                    )\n                    body = json.dumps(payload).encode()'
new='                        "[[workspace-task-grant:" + capability + "]]"\n                    ))\n                    body = json.dumps(payload).encode()'
if new not in s:
    if s.count(old)!=1: raise SystemExit("SAFE STOP: task routing tail differs")
    s=s.replace(old,new,1)
p.write_text(s)
print("PREPARED: current-message routing for both Chat and Paperclip tasks")
PY
PYTHONDONTWRITEBYTECODE=1 python3 -m py_compile "$STAGE/hermes_gateway_bridge.py" "$STAGE/hermes_intent_router.py"
(
cd "$STAGE"
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_hermes_intent_router.py' -v
)
echo "INTENT TESTS PASSED"

# Read-only developer workspace permission, granted to the verified agent only.
python3 - "$SCOPE" "$IDENTITY" "$STAGE/scope.json" <<'PY'
import json,sys
s=json.load(open(sys.argv[1]))
i=json.load(open(sys.argv[2]))
agent,company=i.get("agentId"),i.get("companyId")
assert isinstance(agent,str) and agent and isinstance(company,str) and company
assert s.get("version")==1
g=s.get("agentGrants",{}).get(agent)
assert isinstance(g,dict) and g.get("agentId")==agent and g.get("companyId")==company
assert g.get("workspaceWide") is True and isinstance(g.get("operations"),list)
g["operations"]=sorted(set(g["operations"])|{"developer_workspace"})
with open(sys.argv[3],"w") as f: json.dump(s,f,indent=2,ensure_ascii=False)
print("Developer workspace capability verified for",agent[:8]+"…")
PY

# Discover a real Play Scout source tree, NOT the runtime database or private volume.
# This step is optional: without source, Hermes must disclose that source is missing.
python3 - "$WORK" "$BACKUP" <<'PY'
from pathlib import Path
import os,re,sys,json,subprocess
work=Path(sys.argv[1]).resolve()
backup=Path(sys.argv[2])
destination=work/"scout-code-reference"
candidates=[]
for root in ("/srv/play-scout","/srv/play-scout-source","/opt/play-scout",
             "/srv/hermes-stack/play-scout","/srv/hermes-stack/play-scout-source"):
    candidates.append(Path(root))
try:
    result=subprocess.run(["docker","inspect","play-scout-app-1","--format","{{json .Mounts}}"],
        check=True,capture_output=True,text=True,timeout=8)
    for entry in json.loads(result.stdout):
        if entry.get("Type")=="bind":
            path=Path(entry.get("Source",""))
            candidates.extend([path,path.parent])
except Exception: pass
source=None
for candidate in candidates:
    try:
        candidate=candidate.resolve(strict=True)
        if candidate==work or work in candidate.parents or candidate in work.parents:
            continue
        if not candidate.is_dir() or candidate.is_symlink():
            continue
        parts={p.name.lower() for p in candidate.iterdir()}
        if ("package.json" in parts and
            ({"src","app","pages","server"}&parts) and
            ("scout" in str(candidate).lower() or "play" in str(candidate).lower())):
            source=candidate
            break
    except (OSError,PermissionError): continue
if source is None:
    print("SOURCE_SNAPSHOT: unavailable; core tool-based inspection still active")
    raise SystemExit(0)
if destination.exists():
    if not destination.is_dir() or destination.is_symlink():
        raise SystemExit("SAFE STOP: source snapshot path unsafe")
    print("SOURCE_SNAPSHOT: existing snapshot preserved, not overwritten")
    raise SystemExit(0)

stage=work/".scout-code-reference-staging"
if stage.exists(): raise SystemExit("SAFE STOP: snapshot staging exists")
stage.mkdir(mode=0o755)
safe={".ts",".tsx",".js",".jsx",".mjs",".css",".html",".md",".json",".py",".sql"}
blocked={"node_modules","dist","build",".next",".git","private","state",
    "secrets","backups","public","assets","uploads","storage","data","logs"}
secret_names=re.compile(r"(?i)(^\.|env|credential|secret|token|password|keyfile|private|service.account)")
secret_content=re.compile(r"(?i)(-----BEGIN [^-]*PRIVATE KEY-----|sk-(?:proj-)?[A-Za-z0-9_-]{16,}|(?:password|api[_-]?key|client[_-]?secret)\s*[:=]\s*['\"]?[^,\s'\"]{12,})")
files=0
bytes_copied=0
try:
  for directory, subdirs, names in os.walk(source,followlinks=False):
    relative=Path(directory).relative_to(source)
    subdirs[:]=[n for n in subdirs if n not in blocked and
                not n.startswith(".") and not (Path(directory)/n).is_symlink()]
    if len(relative.parts)>10:subdirs[:]=[];continue
    for name in names:
      if files>=900 or bytes_copied>=8_000_000:break
      p=Path(directory)/name
      if p.is_symlink() or p.suffix not in safe or secret_names.search(name):
        continue
      try:
        if not p.is_file() or p.stat().st_size>80_000:continue
        data=p.read_text(encoding="utf8")
      except (OSError,UnicodeError):continue
      if secret_content.search(data):continue
      target=stage/relative/name
      target.parent.mkdir(parents=True,exist_ok=True)
      target.write_text(data)
      os.chmod(target,0o644)
      files+=1;bytes_copied+=len(data.encode())
  if files<3:
    import shutil
    shutil.rmtree(stage)
    print("SOURCE_SNAPSHOT: insufficient verified source files; skipped")
  else:
    os.chmod(stage,0o755)
    stage.rename(destination)
    print("SOURCE_SNAPSHOT: installed",files,"files",bytes_copied,"bytes from",source)
except Exception:
  import shutil
  shutil.rmtree(stage,ignore_errors=True)
  raise
PY

# From this point rollback of modified policy & bridge is mandatory.
CHANGED=0
rollback() {
  code=$?
  trap - ERR
  if [ "$CHANGED" -eq 1 ]; then
    echo "ERROR: restoring Hermes bridge and authorization policy"
    cp -p "$BACKUP/hermes_gateway_bridge.py" "$BRIDGE" || true
    cp -p "$BACKUP/three-tool-scope.json" "$SCOPE" || true
    if [ -f "$BACKUP/hermes_intent_router.py" ]; then
      cp -p "$BACKUP/hermes_intent_router.py" "$ROUTER" || true
    else
      rm -f "$ROUTER"
    fi
    docker restart "$BRIDGE_SERVICE" >/dev/null || true
  fi
  return "$code"
}
trap rollback ERR
CHANGED=1
cp -p "$STAGE/hermes_gateway_bridge.py" "$BRIDGE"
install -m 0644 -o "$(stat -c %u "$BRIDGE")" -g "$(stat -c %g "$BRIDGE")" \
 "$STAGE/hermes_intent_router.py" "$ROUTER"
# Update the existing bind-mounted scope inode, preserving mount visibility.
cat "$STAGE/scope.json" > "$SCOPE"
docker restart "$BRIDGE_SERVICE" >/dev/null
ok=0
for i in $(seq 1 35); do
  bridge="$(docker inspect -f '{{.State.Running}}' "$BRIDGE_SERVICE" 2>/dev/null || echo false)"
  dev="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$DEV_SERVICE" 2>/dev/null || echo unavailable)"
  if [ "$bridge" = true ] && [ "$dev" = healthy ]; then ok=1;break;fi
  sleep 5
done
[ "$ok" -eq 1 ] || { echo "ERROR: Hermes Bridge or Developer Workspace unhealthy";false; }
CHANGED=0
trap - ERR
echo "HERMES PROJECT INTELLIGENCE UPGRADE INSTALLED"
echo "Bridge running; Developer Workspace healthy; product-intent router active"
echo "Existing Chat and task history untouched"
echo "No production code changes; no email sent; no approval bypass"
echo "BACKUP: $BACKUP"
