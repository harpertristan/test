"""Create the first Paperclip owner locally; no credentials in argv/logs."""

import getpass
from datetime import datetime, timezone
from http.cookies import SimpleCookie
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error

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


# The request target is fixed inside the container. Secrets travel only via stdin.
LOCAL_HTTP = r"""
import http from 'node:http';
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw);
if (!/^\/api\/[A-Za-z0-9_/-]+$/.test(input.path) ||
    !['GET', 'POST'].includes(input.method)) process.exit(2);
const body = input.payload === null ? '' : JSON.stringify(input.payload);
const req = http.request({hostname:'127.0.0.1', port:3100,
  path:input.path, method:input.method,
  headers:{'Host':'localhost:3101', 'Origin':'http://localhost:3101',
    'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body),
    'Cookie':input.cookie || ''}}, res => {
  let data = '';
  res.on('data', chunk => { data += chunk; if (data.length > 1048576) res.destroy(); });
  res.on('end', () => console.log(JSON.stringify({status:res.statusCode,
    body:data, cookies:res.headers['set-cookie'] || []})));
});
req.setTimeout(15000, () => req.destroy());
req.on('error', () => { process.exitCode = 1; });
req.end(body);
"""


class LocalSession:
    def __init__(self):
        self.cookies = SimpleCookie()
        self.status = None

    def request(self, method, path, payload=None):
        if method not in ("GET", "POST") or not re.fullmatch(
            r"/api/[A-Za-z0-9_/-]+", path
        ):
            raise ValueError("Неразрешённый локальный путь")
        output = run(
            BASE
            + [
                "exec",
                "-T",
                "paperclip",
                "node",
                "--input-type=module",
                "-e",
                LOCAL_HTTP,
            ],
            input=json.dumps(
                {
                    "method": method,
                    "path": path,
                    "payload": payload,
                    "cookie": self.cookies.output(header="", sep=";").strip(),
                }
            ),
        )
        try:
            result = json.loads(output)
            self.status = int(result["status"])
            for cookie in result.get("cookies", []):
                self.cookies.load(cookie)
            body = result["body"].encode()
            if self.status >= 300:
                raise urllib.error.HTTPError(
                    BASE_URL + path,
                    self.status,
                    "Local API rejected request",
                    {},
                    io.BytesIO(body),
                )
            return json.loads(body)
        except (ValueError, KeyError, TypeError):
            raise RuntimeError("Некорректный ответ внутреннего API Paperclip") from None


def post(session, path, payload):
    if not path.startswith("/api/"):
        raise ValueError("Неразрешённый локальный путь")
    return session.request("POST", path, payload)


def check_api():
    session = LocalSession()
    for method, path, body in [
        ("GET", "/api/health", None),
        ("POST", "/api/auth/sign-in/email", {}),
    ]:
        try:
            session.request(method, path, body)
            print(f"{method} {path}: HTTP {session.status}", flush=True)
        except urllib.error.HTTPError as error:
            code = ""
            try:
                data = json.loads(error.read(4096))
                candidate = data.get("code", "")
                if isinstance(candidate, str) and re.fullmatch(
                    r"[A-Z0-9_]{1,100}", candidate
                ):
                    code = candidate
            except (ValueError, AttributeError):
                pass
            print(f"{method} {path}: HTTP {error.code} {code}", flush=True)
            if method == "GET" or error.code in (403, 429):
                raise RuntimeError(
                    "Проверка локального API не пройдена. Пароль вводить не нужно"
                ) from None
        except urllib.error.URLError as error:
            reason = getattr(error, "reason", None)
            print(
                f"{method} {path}: {type(reason).__name__}; errno={getattr(reason, 'errno', None)}",
                flush=True,
            )
            raise RuntimeError(
                "Локальный API пока недоступен. Пароль вводить не нужно"
            ) from None
    print(
        "Проверка выполнена без email и пароля. Пустой запрос входа должен получить отказ."
    )


def main():
    if os.geteuid() != 0:
        raise SystemExit("Запустите через sudo")
    check_api()
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
        opener = LocalSession()
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
        try:
            post(
                opener,
                "/api/auth/sign-in/email",
                {"email": email, "password": password},
            )
        except urllib.error.HTTPError as error:
            raise RuntimeError(
                f"Вход в Paperclip отклонён: HTTP {error.code}. Регистрация закрывается"
            ) from None
        try:
            accepted = post(
                opener, "/api/invites/" + token + "/accept", {"requestType": "human"}
            )
        except urllib.error.HTTPError as error:
            raise RuntimeError(
                f"Принятие приглашения отклонено: HTTP {error.code}. Регистрация закрывается"
            ) from None
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
        if sys.argv[1:] == ["--check"]:
            check_api()
        else:
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
