"""All isolated worker queues must be reachable through the broker."""

from app.workers.celery_app import celery_app

replies = celery_app.control.inspect(timeout=3).ping() or {}
groups = {name.split("@", 1)[0] for name in replies}
if not {"sync", "classify", "control"}.issubset(groups):
    raise SystemExit(1)
print("sync, classify, control: ready")
