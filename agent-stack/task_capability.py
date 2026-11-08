"""Short-lived signed grants for exactly one Paperclip run; never an API key."""

import hashlib
import hmac
import re
import time

RUN_ID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"


def issue(key, run_id, now=None):
    if not re.fullmatch(RUN_ID, run_id):
        raise ValueError("Invalid run id")
    expiry = int(time.time() if now is None else now) + 1800
    value = f"{run_id}:{expiry}"
    return value + ":" + hmac.new(key, value.encode(), hashlib.sha256).hexdigest()


def persistent_issue(key, run_id, database, now=None):
    """Keep native run idempotency stable across HTTP retries and bridge restarts."""
    import sqlite3

    current = int(time.time() if now is None else now)
    if not re.fullmatch(RUN_ID, run_id):
        raise ValueError("Invalid run id")
    connection = sqlite3.connect(database, timeout=5)
    try:
        connection.execute(
            "CREATE TABLE IF NOT EXISTS grants (run_id TEXT PRIMARY KEY, token TEXT NOT NULL, expires INTEGER NOT NULL)"
        )
        connection.execute("BEGIN IMMEDIATE")
        found = connection.execute(
            "SELECT token, expires FROM grants WHERE run_id=?", (run_id,)
        ).fetchone()
        if found:
            if found[1] < current:
                raise ValueError("Run grant expired")
            return found[0]
        token = issue(key, run_id, now=current)
        connection.execute(
            "INSERT INTO grants VALUES (?,?,?)", (run_id, token, current + 1800)
        )
        connection.execute("DELETE FROM grants WHERE expires < ?", (current - 172800,))
        connection.commit()
        return token
    finally:
        connection.close()
