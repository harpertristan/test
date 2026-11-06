"""Create the first Paperclip owner locally; no credentials in argv/logs."""

import getpass
from datetime import datetime, timezone
import http.cookiejar
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.error
import urllib.request

ROOT = Path("/srv/hermes-stack")
HERE = Path(__file__).resolve().parent
BASE_URL = "http://localhost:3101"
DOCKER = ["docker", "--host=unix:///var/run/docker.sock"]
BASE = DOCKER + [
    "compose",
    "-f",
    str(HERE / "compose.yaml"),
    "-f",
    str(HERE / "compose.paperclip.yaml"),
]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def run(command, *, input=None):
    result = subprocess.run(command, input=input, capture_output=True, text=True)
    if result.returncode:
        # Output can contain bootstrap links or connection strings: do not print it.
        raise RuntimeError(
            "Служебная команда Paperclip не выполнена; секретный вывод не печатался"
        )
    return result.stdout


def read_identity():
    email = input("Email для входа в Paperclip: ").strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise ValueError("Введите корректный email")
    name = input("Имя (Enter — Владелец): ").strip() or "Владелец"
    if len(name) > 120:
        raise ValueError("Имя слишком длинное")
    password = getpass.getpass("Придумайте пароль Paperclip (ввод скрыт): ")
    if not 12 <= len(password) <= 128:
        raise ValueError("Пароль должен содержать от 12 до 128 символов")
    if password != getpass.getpass("Повторите пароль: "):
        raise ValueError("Пароли не совпали")
    return email, name, password


def owner_config():
    return {
        "$meta": {
            "version": 1,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
            "source": "configure",
        },
        "database": {"mode": "postgres"},
        "logging": {"mode": "file", "logDir": "/paperclip/logs"},
        "server": {
            "deploymentMode": "authenticated",
            "exposure": "private",
            "host": "0.0.0.0",
            "port": 3100,
        },
        "telemetry": {"enabled": False},
        "updates": {"checkEnabled": False},
        "auth": {
            "baseUrlMode": "explicit",
            "publicBaseUrl": BASE_URL,
            "disableSignUp": True,
        },
    }


def create_invite():
    config = ROOT / "state/paperclip/owner-bootstrap.json"
    config.write_text(json.dumps(owner_config()))
    os.chown(config, 1000, 1000)
    os.chmod(config, 0o600)
    program = """import { bootstrapCeoInvite } from '/app/cli/src/commands/auth-bootstrap-ceo.ts';
await bootstrapCeoInvite({config:'/paperclip/owner-bootstrap.json', baseUrl:'http://localhost:3101', expiresHours:1});"""
    output = run(
        BASE
        + [
            "exec",
            "-T",
            "--workdir",
            "/app/cli",
            "paperclip",
            "node",
            "--import",
            "tsx",
            "--input-type=module",
            "-e",
            program,
        ]
    )
    token = re.search(r"pcp_bootstrap_[a-f0-9]{48}", output)
    if not token:
        if "already has an admin" in output:
            raise ValueError(
                "В Paperclip уже есть владелец. Его учётная запись не изменялась"
            )
        raise RuntimeError(
            "Штатное приглашение не создано; запуск остановлен без открытия регистрации"
        )
    return token.group(0)


def post(opener, path, payload):
    if not path.startswith("/api/"):
        raise ValueError("Неразрешённый локальный путь")
    request = urllib.request.Request(
        BASE_URL + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Origin": BASE_URL},
        method="POST",
    )
    with opener.open(request, timeout=30) as response:
        return json.load(response)


def main():
    if os.geteuid() != 0:
        raise SystemExit("Запустите через sudo")
    email, name, password = read_identity()
    token = create_invite()
    temporary = ROOT / "private/paperclip-owner-bootstrap.yaml"
    if temporary.exists():
        raise SystemExit(
            "Остался файл прошлого bootstrap; сначала проверьте состояние Paperclip"
        )
    temporary.write_text(
        "services:\n  paperclip:\n    environment:\n      PAPERCLIP_AUTH_DISABLE_SIGN_UP: 'false'\n"
    )
    os.chmod(temporary, 0o600)
    success = False
    try:
        print("Создаю владельца через закрытый локальный доступ…", flush=True)
        run(
            BASE
            + [
                "-f",
                str(temporary),
                "up",
                "-d",
                "--no-deps",
                "--wait",
                "--wait-timeout",
                "150",
                "paperclip",
            ]
        )
        # Ignore inherited HTTP proxies and reject redirects: credentials never leave localhost.
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}),
            NoRedirect(),
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
        )
        try:
            post(
                opener,
                "/api/auth/sign-up/email",
                {"email": email, "name": name, "password": password},
            )
        except urllib.error.HTTPError as error:
            if error.code not in (400, 409, 422):
                raise RuntimeError(
                    "Paperclip отклонил создание учётной записи"
                ) from None
            # Recover an interrupted bootstrap only when the same credentials authenticate.
        post(opener, "/api/auth/sign-in/email", {"email": email, "password": password})
        accepted = post(
            opener, "/api/invites/" + token + "/accept", {"requestType": "human"}
        )
        if accepted.get("bootstrapAccepted") is not True:
            raise RuntimeError("Paperclip не подтвердил назначение владельца")
        success = True
    finally:
        print("Закрываю регистрацию…", flush=True)
        try:
            run(
                BASE
                + [
                    "up",
                    "-d",
                    "--no-deps",
                    "--wait",
                    "--wait-timeout",
                    "150",
                    "paperclip",
                ]
            )
        except Exception:
            # Never leave a registration-enabled controller running after a failed restore.
            subprocess.run(BASE + ["stop", "paperclip"], capture_output=True, text=True)
            raise RuntimeError(
                "Не удалось закрыть регистрацию; Paperclip остановлен. Остальные сервисы не менялись"
            ) from None
        finally:
            if temporary.exists():
                temporary.unlink()
    if success:
        print("Учётная запись владельца создана. Регистрация снова закрыта.")
        print(
            "Пароль и одноразовое приглашение не выводились. Панель пока не опубликована."
        )


if __name__ == "__main__":
    try:
        main()
    except (urllib.error.URLError, urllib.error.HTTPError):
        raise SystemExit(
            "Локальный API Paperclip отклонил запрос. Регистрация закрыта; пароль не выводился"
        ) from None
    except (RuntimeError, ValueError) as error:
        raise SystemExit(str(error)) from None
    except KeyboardInterrupt:
        raise SystemExit(
            "Ввод отменён. Проверьте, что Paperclip запущен с закрытой регистрацией"
        ) from None
