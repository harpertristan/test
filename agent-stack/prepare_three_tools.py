"""Opt-in, fail-closed provisioning for Hermes read-only app tools."""
import json
import os
from pathlib import Path

from bootstrap_owner import ROOT
from prepare_task_control import CONFIG as ORIGINAL_CONFIG

OLD = "include: [current_task, submit_result]"
NEW = "include: [current_task, submit_result, scout_read, assistant_read, mail_crm_read]"


def main():
    if os.geteuid() != 0:
        raise SystemExit("Use sudo")
    config = ROOT / "config/hermes-gateway.yaml"
    existing = config.read_text()
    expected = ORIGINAL_CONFIG.replace(OLD, NEW)
    if existing not in (ORIGINAL_CONFIG, expected):
        raise SystemExit("Unexpected Hermes config: no changes made")
    private = ROOT / "private"
    scope = private / "three-tool-scope.json"
    if not scope.exists():
        fd = os.open(scope, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o400)
        with os.fdopen(fd, "w") as handle:
            json.dump({"version": 1, "grants": {}}, handle)
            handle.write("\n")
    parsed = json.loads(scope.read_text())
    if not isinstance(parsed, dict) or parsed.get("version") != 1 or not isinstance(parsed.get("grants"), dict):
        raise SystemExit("Invalid existing scope file: no changes made")
    os.chown(scope, 10000, 10000)
    os.chmod(scope, 0o400)
    sockets = ROOT / "three-tools"
    sockets.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chown(sockets, 10000, 10000)
    os.chmod(sockets, 0o700)
    if existing != expected:
        config.write_text(expected)
    os.chmod(config, 0o444)
    print("Three-tool access configured; all application reads DENIED until explicit task grants.")
    print("Existing task status tools remain available; no services were restarted.")


if __name__ == "__main__":
    main()
