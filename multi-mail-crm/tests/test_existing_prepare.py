import importlib.util
from pathlib import Path
import pytest

spec = importlib.util.spec_from_file_location(
    "prepare_existing",
    Path(__file__).resolve().parents[1] / "integration/prepare_existing.py",
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_import_existing_keys_changes_only_new_env_and_preserves_new_values(tmp_path):
    crm = tmp_path / "crm"
    workspace = tmp_path / "workspace"
    scout = tmp_path / "scout"
    for path in (crm, workspace, scout):
        path.mkdir()
    (crm / ".env.example").write_text(
        "POSTGRES_PASSWORD=replace-with-random-url-safe-password\nJWT_SECRET=replace-with-at-least-32-random-characters\nFERNET_KEY=replace-with-generated-fernet-key\nOPENAI_API_KEY=\nPUBLIC_URL=http://localhost:3000\nAPP_BASE_PATH=/mail-crm\n"
    )
    shared = "a" * 64
    (workspace / "workspace.env").write_text(
        "WORKSPACE_SHARED_SECRET=" + shared + "\nWORKSPACE_USER=owner\n"
    )
    (scout / "app.env").write_text(
        "OPENAI_API_KEY=synthetic-allowed-test-key\nAPP_PASSWORD=preserve-old-password\n"
    )
    before = [p.read_bytes() for p in (workspace / "workspace.env", scout / "app.env")]
    module.prepare(crm, workspace, scout, "https://workspace.example.com")
    values = module.read_env(crm / ".env")
    assert values["OPENAI_API_KEY"] == "synthetic-allowed-test-key"
    assert (
        values["WORKSPACE_SHARED_SECRET"] == shared
        and values["APP_BASE_PATH"] == "/mail-crm"
    )
    assert "APP_PASSWORD" not in values
    assert before == [
        p.read_bytes() for p in (workspace / "workspace.env", scout / "app.env")
    ]
    (scout / "app.env").write_text("OPENAI_API_KEY=another-test-key\n")
    module.prepare(crm, workspace, scout, "https://workspace.example.com")
    assert (
        module.read_env(crm / ".env")["OPENAI_API_KEY"] == "synthetic-allowed-test-key"
    )
    assert (crm / ".env").stat().st_mode & 0o777 == 0o600


def test_prepare_refuses_unsupported_origin_and_missing_existing_key(tmp_path):
    with pytest.raises(ValueError):
        module.prepare(tmp_path, tmp_path, tmp_path, "http://bad.example")
    with pytest.raises(ValueError):
        module.prepare(tmp_path, tmp_path, tmp_path, "https://workspace.example.com")
