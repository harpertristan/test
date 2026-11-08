"""Publish the authenticated panel through existing Caddy; preserve old routes."""

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import socket
import subprocess

from bootstrap_owner import BASE, DOCKER, HERE, ROOT, run

CADDY = "play-scout-caddy-1"
NETWORK = "workspace-agent_paperclip-web"
CANDIDATE = "/tmp/workspace-paperclip-Caddyfile"
DEFAULT_DOMAIN = "agents.34.22.184.67.sslip.io"
MARKER = "# BEGIN workspace-paperclip managed panel"


def panel_block(domain):
    if not re.fullmatch(r"[a-z0-9]+(?:[.-][a-z0-9]+)+", domain):
        raise ValueError("Некорректный домен")
    return f"""\n{MARKER}
{domain} {{
    header X-Robots-Tag "noindex, nofollow, noarchive"
    tls {{
        issuer acme {{
            dir https://acme-v02.api.letsencrypt.org/directory
        }}
    }}
    encode zstd gzip
    request_body {{
        max_size 25MB
    }}
    reverse_proxy paperclip-panel:3100
}}
# END workspace-paperclip managed panel
"""


def append_panel(original, domain):
    block = panel_block(domain)
    if MARKER in original:
        if block.strip() not in original:
            raise ValueError("Уже есть другая конфигурация панели; перезапись отменена")
        return original
    if domain in original:
        raise ValueError("Домен уже используется в Caddyfile")
    return original.rstrip() + "\n" + block


def panel_environment(original, domain):
    panel_block(domain)  # Same strict domain validation as the Caddy configuration.
    lines = [
        line
        for line in original.splitlines()
        if not line.startswith("PAPERCLIP_PANEL_ORIGIN=")
    ]
    return "\n".join(lines) + f"\nPAPERCLIP_PANEL_ORIGIN=https://{domain}\n"


def private_write(path, value):
    with path.open("w") as output:
        os.fchmod(output.fileno(), 0o600)
        output.write(value)


def reload_caddy():
    run(
        DOCKER
        + [
            "exec",
            CADDY,
            "caddy",
            "reload",
            "--config",
            "/etc/caddy/Caddyfile",
            "--adapter",
            "caddyfile",
        ]
    )


def start_panel():
    run(
        BASE + ["up", "-d", "--no-deps", "--wait", "--wait-timeout", "150", "paperclip"]
    )


def main(domain):
    if os.geteuid() != 0:
        raise ValueError("Запустите через sudo")
    panel_block(domain)
    addresses = {item[4][0] for item in socket.getaddrinfo(domain, 443)}
    if addresses != {"34.22.184.67"}:
        raise ValueError(
            "DNS домена не совпадает с адресом сервера; изменения отменены"
        )
    info = json.loads(run(DOCKER + ["inspect", CADDY]))[0]
    mount = next(
        (m for m in info["Mounts"] if m["Destination"] == "/etc/caddy/Caddyfile"), None
    )
    if not mount or mount["Type"] != "bind":
        raise ValueError("Ожидался Caddyfile, подключённый как bind mount")
    caddy_path = Path(mount["Source"])
    original = caddy_path.read_text()
    candidate = append_panel(original, domain)
    # Validate using Caddy's actual environment, without displaying expanded config.
    run(
        DOCKER + ["exec", "-i", CADDY, "sh", "-c", f"cat > {CANDIDATE}"],
        input=candidate,
    )
    run(
        DOCKER
        + [
            "exec",
            CADDY,
            "caddy",
            "validate",
            "--config",
            CANDIDATE,
            "--adapter",
            "caddyfile",
        ]
    )
    environment = HERE / ".env"
    old_environment = environment.read_text() if environment.exists() else None
    backup = (
        ROOT
        / "private"
        / ("panel-backup-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))
    )
    backup.mkdir(mode=0o700)
    private_write(backup / "Caddyfile", original)
    if old_environment is not None:
        private_write(backup / "compose.env", old_environment)
    try:
        private_write(environment, panel_environment(old_environment or "", domain))
        run(BASE + ["config", "--quiet"])
        start_panel()
        network = json.loads(run(DOCKER + ["network", "inspect", NETWORK]))[0]
        if not network.get("Internal"):
            raise RuntimeError("Сеть панели должна быть внутренней")
        if info["Id"] not in network.get("Containers", {}):
            run(DOCKER + ["network", "connect", NETWORK, CADDY])
        run(
            DOCKER
            + [
                "exec",
                CADDY,
                "wget",
                "--header",
                "Host: " + domain,
                "-q",
                "-O",
                "/dev/null",
                "http://paperclip-panel:3100/api/health",
            ]
        )
        # Write in place: replacing the inode would leave Caddy's bind mount stale.
        caddy_path.write_text(candidate)
        reload_caddy()
    except Exception:
        caddy_path.write_text(original)
        if old_environment is None:
            environment.unlink(missing_ok=True)
        else:
            private_write(environment, old_environment)
        try:
            reload_caddy()
            start_panel()
        except Exception:
            raise RuntimeError(
                f"Откат не завершён; резервная копия: {backup}"
            ) from None
        raise RuntimeError(
            "Публикация не завершена; прежние маршруты и настройки панели восстановлены"
        ) from None
    print(f"Панель подключена: https://{domain}")
    print("Регистрация закрыта; scheduler агентов выключен. Hermes не менялся.")
    print("Выдача HTTPS-сертификата может занять несколько минут.")
    print(f"Резервная копия: {backup}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--domain", default=DEFAULT_DOMAIN)
    args = parser.parse_args()
    try:
        main(args.domain)
    except (RuntimeError, ValueError, OSError, subprocess.SubprocessError) as error:
        raise SystemExit(str(error)) from None
