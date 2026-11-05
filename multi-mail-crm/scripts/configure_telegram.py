"""Configure a dedicated CRM bot without putting its token in shell history."""

import getpass
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.request import urlopen


def main():
    path = Path(__file__).resolve().parents[1] / ".env"
    if not path.is_file():
        raise SystemExit("Файл .env CRM не найден. Сначала установите CRM.")
    token = getpass.getpass(
        "Вставьте токен BotFather (ввод скрыт) и нажмите Enter: "
    ).strip()
    if not re.fullmatch(r"[0-9]+:[A-Za-z0-9_-]{20,}", token):
        raise SystemExit("Формат токена неверный. Настройки не изменены.")
    try:
        with urlopen(
            "https://api.telegram.org/bot" + token + "/getMe", timeout=20
        ) as response:
            result = json.load(response)
        bot = result["result"]
        username = bot["username"]
        if (
            not result.get("ok")
            or not bot.get("is_bot")
            or not re.fullmatch(r"[A-Za-z0-9_]+", username)
        ):
            raise ValueError("Invalid bot response")
    except Exception:
        # Request exceptions can contain the URL (and therefore the token).
        raise SystemExit(
            "Telegram не подтвердил токен. Проверьте токен и доступ сервера к api.telegram.org. Настройки не изменены."
        ) from None
    values = {"TELEGRAM_BOT_TOKEN": token, "TELEGRAM_BOT_USERNAME": username}
    lines = [
        line
        for line in path.read_text().splitlines()
        if line.split("=", 1)[0].strip() not in values
    ]
    lines.extend(f"{key}={value}" for key, value in values.items())
    descriptor, temporary = tempfile.mkstemp(prefix=".telegram-env-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w") as output:
            os.fchmod(output.fileno(), 0o600)
            output.write("\n".join(lines) + "\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print(f"Бот @{username} проверен. Токен сохранён только в .env CRM.")


if __name__ == "__main__":
    main()
