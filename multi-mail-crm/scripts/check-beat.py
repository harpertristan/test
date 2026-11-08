"""Beat must keep synchronizing its persistent scheduler, not just own a PID."""

import time
from pathlib import Path

files = list(Path("/state").glob("celerybeat-schedule*"))
if not files or time.time() - max(path.stat().st_mtime for path in files) > 600:
    raise SystemExit(1)
print("persistent beat scheduler: active")
