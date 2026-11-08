"""Host-side setup. No keys enter the Hermes container or terminal output."""

import getpass
import os
from pathlib import Path
import re
import shlex
import tempfile

ROOT = Path("/srv/hermes-stack")
SOURCE_ENV = Path("/srv/mail-crm-source/multi-mail-crm/.env")
CONFIG = """model:
  provider: custom
  default: gpt-4o-mini
  base_url: http://127.0.0.1:18080/v1
  api_key: local-bridge-only
  context_length: 64000
approvals:
  mode: manual
  cron_mode: deny
  single_query_mode: deny
  unattended_mode: deny
"""


def main():
    if os.geteuid() != 0:
        raise SystemExit("Запустите настройку через sudo")
    if not ROOT.is_dir():
        raise SystemExit("Нет /srv/hermes-stack")
    source_dir = Path(__file__).resolve().parent
    os.chmod(source_dir, 0o755)
    for name in ("model_proxy.py", "launch_hermes.py", "probe_gateway.py"):
        os.chmod(source_dir / name, 0o644)
    private = ROOT / "private"
    private.mkdir(mode=0o700, exist_ok=True)
    os.chmod(private, 0o700)
    keypath = private / "openai.key"
    if keypath.exists():
        key = keypath.read_text().strip()
    else:
        key = ""
        source = SOURCE_ENV
        if source.is_file():
            for line in source.read_text().splitlines():
                match = re.match(r"\s*(?:export\s+)?OPENAI_API_KEY\s*=(.*)", line)
                if match:
                    parts = shlex.split(match.group(1), comments=True)
                    if len(parts) == 1:
                        key = parts[0]
        if not key or key.startswith("replace-"):
            key = getpass.getpass("Ключ OpenAI (ввод скрыт): ").strip()
    if not re.fullmatch(r"sk-[A-Za-z0-9_-]{20,}", key):
        raise SystemExit("Ключ не распознан; значения не выводились")
    config_dir = ROOT / "config"
    config_dir.mkdir(mode=0o755, exist_ok=True)
    config_path = config_dir / "hermes.yaml"
    if config_path.exists() and config_path.read_text() != CONFIG:
        raise SystemExit(
            "Конфигурация Hermes уже изменена вручную; перезапись отменена"
        )
    descriptor, temp = tempfile.mkstemp(dir=private)
    try:
        with os.fdopen(descriptor, "w") as output:
            output.write(key + "\n")
            output.flush()
            os.fsync(output.fileno())
        os.chown(temp, 10000, 10000)
        os.chmod(temp, 0o400)
        os.replace(temp, keypath)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)
    for directory in (
        ROOT / "model-bridge",
        ROOT / "state" / "hermes",
        ROOT / "state" / "model-proxy",
    ):
        directory.mkdir(parents=True, mode=0o700, exist_ok=True)
        os.chown(directory, 10000, 10000)
        os.chmod(directory, 0o700)
    config_path.write_text(CONFIG)
    os.chmod(config_path, 0o444)
    print(
        "Настройки сохранены. Ключ доступен только шлюзу; ключ CRM и старые сервисы не менялись."
    )


if __name__ == "__main__":
    main()
