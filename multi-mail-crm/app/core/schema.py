"""Resolve the schema expected by this build directly from its migration files."""

from functools import lru_cache
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory


@lru_cache(maxsize=1)
def expected_schema_revision() -> str:
    root = Path(__file__).resolve().parents[2]
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "alembic"))
    revision = ScriptDirectory.from_config(config).get_current_head()
    if not revision:
        raise RuntimeError("No schema migration head found")
    return revision
