"""Check every supplied legacy source file against the user's exact commits."""

import argparse
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1] / "integration"
parser = argparse.ArgumentParser()
parser.add_argument("--installed", type=Path)
args = parser.parse_args()
locks = json.loads((root / "sources.lock.json").read_text())
for name, entry in locks.items():
    checked = 0
    for file, expected in entry["files"].items():
        if args.installed and not (
            file in ("server.js", "package.json", "package-lock.json")
            or file.startswith(("lib/", "public/"))
        ):
            continue
        checked += 1
        path = (
            args.installed
            / {"play-scout": "scout", "registration-assistant": "assistant"}[name]
            if args.installed
            else root / "tools" / name
        ) / file
        if (
            not path.is_file()
            or hashlib.sha256(path.read_bytes()).hexdigest() != expected
        ):
            raise SystemExit(f"Source mismatch: {name}/{file}")
    print(f"{name}: {entry['commit']} — {checked} unchanged files verified")
