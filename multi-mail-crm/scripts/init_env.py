"""Generate local-only secrets. Never overwrites an existing .env."""

import base64
import os
import secrets
from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / ".env"
text = (root / ".env.example").read_text()
text = text.replace("replace-with-random-url-safe-password", secrets.token_hex(24))
text = text.replace("replace-with-at-least-32-random-characters", secrets.token_hex(32))
text = text.replace(
    "replace-with-generated-fernet-key",
    base64.urlsafe_b64encode(secrets.token_bytes(32)).decode(),
)
try:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
except FileExistsError:
    raise SystemExit(".env уже существует: файл сохранён без изменений")
with os.fdopen(descriptor, "w") as handle:
    handle.write(text)
print(".env создан с новыми случайными ключами; значения не выводятся")
