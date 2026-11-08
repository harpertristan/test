from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app import cli


@pytest.mark.asyncio
@pytest.mark.parametrize("prefix", ["", "/mail-crm"])
async def test_telegram_webhook_uses_public_app_prefix(monkeypatch, prefix):
    bot = SimpleNamespace(
        set_webhook=AsyncMock(),
        get_me=AsyncMock(return_value=SimpleNamespace(username="test_crm_bot")),
        session=SimpleNamespace(close=AsyncMock()),
    )
    monkeypatch.setattr("aiogram.Bot", Mock(return_value=bot))
    monkeypatch.setattr(
        "app.services.notify.telegram.webhook_secret", lambda: "test-secret"
    )
    monkeypatch.setattr(
        cli,
        "settings",
        lambda: SimpleNamespace(
            public_url="https://crm.example.com",
            app_url="https://crm.example.com" + prefix,
            telegram_bot_token="test-token",
        ),
    )
    await cli.telegram_setup()
    bot.set_webhook.assert_awaited_once_with(
        "https://crm.example.com" + prefix + "/api/webhooks/telegram",
        secret_token="test-secret",
        allowed_updates=["message", "callback_query"],
        drop_pending_updates=False,
    )
    bot.session.close.assert_awaited_once()


def load_configure_script(monkeypatch, tmp_path):
    import importlib.util
    from pathlib import Path

    source = Path(__file__).resolve().parents[1] / "scripts/configure_telegram.py"
    spec = importlib.util.spec_from_file_location("configure_telegram", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(
        module, "__file__", str(tmp_path / "scripts/configure_telegram.py")
    )
    return module


def test_configure_telegram_preserves_other_secrets_and_hides_token(
    monkeypatch, tmp_path, capsys
):
    import io
    import stat

    module = load_configure_script(monkeypatch, tmp_path)
    path = tmp_path / ".env"
    path.write_text("FERNET_KEY=keep-existing-key\nTELEGRAM_BOT_TOKEN=old-token\n")
    token = "123456789:" + "t" * 35
    monkeypatch.setattr(module.getpass, "getpass", lambda _: token)
    monkeypatch.setattr(
        module,
        "urlopen",
        lambda *a, **kw: io.StringIO(
            '{"ok":true,"result":{"is_bot":true,"username":"crm_test_bot"}}'
        ),
    )
    module.main()
    assert (
        path.read_text()
        == "FERNET_KEY=keep-existing-key\nTELEGRAM_BOT_TOKEN="
        + token
        + "\nTELEGRAM_BOT_USERNAME=crm_test_bot\n"
    )
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert token not in capsys.readouterr().out


def test_configure_telegram_network_failure_does_not_leak_token(monkeypatch, tmp_path):
    module = load_configure_script(monkeypatch, tmp_path)
    path = tmp_path / ".env"
    path.write_text("FERNET_KEY=keep-existing-key\n")
    token = "123456789:" + "t" * 35
    monkeypatch.setattr(module.getpass, "getpass", lambda _: token)

    def fail(*args, **kwargs):
        raise RuntimeError("Request failed: " + token)

    monkeypatch.setattr(module, "urlopen", fail)
    with pytest.raises(SystemExit) as error:
        module.main()
    assert token not in str(error.value)
    assert path.read_text() == "FERNET_KEY=keep-existing-key\n"
