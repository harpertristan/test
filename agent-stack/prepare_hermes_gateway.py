"""Prepare a separate internal API key/state, without changing existing agents."""

import os
import re
import secrets

from bootstrap_owner import ROOT
from prepare import CONFIG

GATEWAY_CONFIG = (
    CONFIG
    + """platform_toolsets:
  api_server: []
mcp_servers: {}
agent:
  max_iterations: 10
"""
)


def main():
    if os.geteuid() != 0:
        raise SystemExit("Запустите через sudo")
    private = ROOT / "private"
    if not private.is_dir():
        raise SystemExit("Сначала выполните базовую подготовку Hermes")
    keypath = private / "hermes-gateway.key"
    if keypath.exists():
        if not re.fullmatch(r"[A-Za-z0-9_-]{40,100}", keypath.read_text().strip()):
            raise SystemExit("Существующий ключ не распознан; перезапись отменена")
    else:
        fd = os.open(keypath, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o400)
        with os.fdopen(fd, "w") as output:
            output.write(secrets.token_urlsafe(48) + "\n")
    os.chown(keypath, 10000, 10000)
    os.chmod(keypath, 0o400)
    for path in (ROOT / "hermes-bridge", ROOT / "state/hermes-gateway"):
        path.mkdir(parents=True, mode=0o700, exist_ok=True)
        os.chown(path, 10000, 10000)
        os.chmod(path, 0o700)
    config = ROOT / "config/hermes-gateway.yaml"
    if config.exists() and config.read_text() != GATEWAY_CONFIG:
        raise SystemExit("Конфигурация API изменена вручную; перезапись отменена")
    if not config.exists():
        config.write_text(GATEWAY_CONFIG)
    os.chmod(config, 0o444)
    print("Отдельный ключ и хранилище Hermes API подготовлены; ключ не выводился.")
    print(
        "Первый этап: только текст, без инструментов, Telegram и доступа к приложениям."
    )


if __name__ == "__main__":
    main()
