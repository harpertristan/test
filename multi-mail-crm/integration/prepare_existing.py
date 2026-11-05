"""Prepare only the NEW CRM .env. Read existing settings; never modify old tools."""

import argparse
import base64
import json
import os
import re
import secrets
from pathlib import Path
from urllib.parse import urlparse


def read_env(path):
    values = {}
    if not path.is_file():
        return values
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, sep, value = line.partition("=")
        if not sep or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            if value[0] == '"':
                try:
                    value = json.loads(value)
                except ValueError:
                    raise ValueError(f"Unsupported quoted value for {key}") from None
            else:
                value = value[1:-1].replace("\\'", "'").replace("\\\\", "\\")
        if "${" in value:
            continue
        values[key] = value
    return values


def prepare(crm, workspace, scout, public_url):
    parsed = urlparse(public_url)
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.path not in ("", "/")
        or parsed.username
        or parsed.password
    ):
        raise ValueError("Supply the existing HTTPS origin without a path")
    old = read_env(workspace / "workspace.env")
    key = old.get("WORKSPACE_SHARED_SECRET", "")
    if len(key) < 32:
        raise ValueError(
            "Existing workspace.env is missing a usable WORKSPACE_SHARED_SECRET"
        )
    env = crm / ".env"
    current = read_env(env)
    if (
        current.get("WORKSPACE_SHARED_SECRET")
        and current["WORKSPACE_SHARED_SECRET"] != key
    ):
        raise ValueError(
            "New CRM already uses a different workspace key; review its .env before proceeding"
        )
    if not env.exists():
        template = (
            (crm / ".env.example")
            .read_text()
            .replace("replace-with-random-url-safe-password", secrets.token_hex(24))
            .replace(
                "replace-with-at-least-32-random-characters", secrets.token_hex(32)
            )
            .replace(
                "replace-with-generated-fernet-key",
                base64.urlsafe_b64encode(secrets.token_bytes(32)).decode(),
            )
        )
        descriptor = os.open(env, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as file:
            file.write(template)
        current = read_env(env)
    imported = []
    source = read_env(scout / "app.env")
    allowed = (
        "OPENAI_API_KEY",
        "OPENAI_MODEL",
        "ZOHO_CLIENT_ID",
        "ZOHO_CLIENT_SECRET",
        "ZOHO_ORGANIZATION_ID",
        "GMAIL_CLIENT_ID",
        "GMAIL_CLIENT_SECRET",
        "TELEGRAM_BOT_TOKEN",
        "TELEGRAM_BOT_USERNAME",
    )
    values = {
        "WORKSPACE_SHARED_SECRET": key,
        "PUBLIC_URL": public_url.rstrip("/"),
        "APP_BASE_PATH": "/mail-crm",
    }
    for name in allowed:
        if source.get(name) and not current.get(name):
            values[name] = source[name]
            imported.append(name)
    original = env.read_text()
    lines = original.splitlines()
    remaining = dict(values)

    def quote(value):
        if "\n" in value or "\r" in value:
            raise ValueError("Multiline values are not supported")
        return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"

    for i, line in enumerate(lines):
        key_name = line.partition("=")[0]
        if key_name in remaining:
            lines[i] = key_name + "=" + quote(remaining.pop(key_name))
    lines.extend(name + "=" + quote(value) for name, value in remaining.items())
    temporary = env.with_name(".env.mail-crm.tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w") as file:
            file.write("\n".join(lines) + "\n")
        os.replace(temporary, env)
    finally:
        if temporary.exists():
            temporary.unlink()
    print("Prepared the NEW CRM .env; existing settings and data were read-only.")
    print(
        "Imported key names:",
        ", ".join(imported) or "none; existing CRM values preserved",
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--workspace", type=Path, default=Path("/srv/play-scout-workspace")
    )
    parser.add_argument("--scout", type=Path, default=Path("/srv/play-scout"))
    parser.add_argument("--public-url", required=True)
    args = parser.parse_args()
    prepare(
        Path(__file__).resolve().parents[1], args.workspace, args.scout, args.public_url
    )
