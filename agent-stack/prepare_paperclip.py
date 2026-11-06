"""Create only Paperclip's private secrets/state; never read app credentials."""

import os
from pathlib import Path
import re
import secrets
import tempfile

ROOT = Path("/srv/hermes-stack")


def atomic_private(path, content):
    descriptor, temp = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(descriptor, "w") as output:
            os.fchmod(output.fileno(), 0o600)
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def main():
    if os.geteuid() != 0 or not ROOT.is_dir():
        raise SystemExit("Запустите через sudo после подготовки /srv/hermes-stack")
    private = ROOT / "private"
    private.mkdir(mode=0o700, exist_ok=True)
    os.chmod(private, 0o700)
    database = private / "paperclip-postgres.env"
    if database.exists():
        match = re.search(
            r"^POSTGRES_PASSWORD=([A-Za-z0-9_-]+)$", database.read_text(), re.MULTILINE
        )
        if not match:
            raise SystemExit("Существующий пароль БД не распознан; перезапись отменена")
        password = match.group(1)
    else:
        password = secrets.token_urlsafe(32)
        atomic_private(
            database,
            f"POSTGRES_DB=paperclip\nPOSTGRES_USER=paperclip\nPOSTGRES_PASSWORD={password}\n",
        )
    application = private / "paperclip.env"
    if not application.exists():
        atomic_private(
            application,
            f"DATABASE_URL=postgresql://paperclip:{password}@paperclip-db:5432/paperclip\n"
            f"BETTER_AUTH_SECRET={secrets.token_urlsafe(48)}\n"
            f"PAPERCLIP_AGENT_JWT_SECRET={secrets.token_urlsafe(48)}\n",
        )
    else:
        expected = f"DATABASE_URL=postgresql://paperclip:{password}@paperclip-db:5432/paperclip"
        if expected not in application.read_text().splitlines():
            raise SystemExit(
                "Настройки БД не совпали; существующие секреты не менялись"
            )
    state = ROOT / "state" / "paperclip"
    state.mkdir(parents=True, mode=0o700, exist_ok=True)
    os.chown(state, 1000, 1000)
    os.chmod(state, 0o700)
    print(
        "Секреты и отдельное хранилище Paperclip подготовлены. Значения не выводились."
    )
    print(
        "Панель настроена только на локальный порт 3101; регистрация и запуски агентов выключены."
    )


if __name__ == "__main__":
    main()
