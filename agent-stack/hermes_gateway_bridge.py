"""Restricted Paperclip loopback -> Unix -> native Hermes API transport."""

import hmac
import http.client
import http.server
import json
import os
from pathlib import Path
import re
import socket
import socketserver

SOCKET = "/run/hermes-bridge/runtime.sock"
KEY_FILE = "/run/secrets/hermes-gateway.key"
RUN = r"/v1/runs/[A-Za-z0-9_-]{1,128}"


def allowed(method, path):
    if method == "GET":
        return path in ("/health", "/v1/models", "/v1/capabilities") or bool(
            re.fullmatch(RUN + r"(?:/events)?", path)
        )
    return method == "POST" and (
        path == "/v1/runs" or bool(re.fullmatch(RUN + r"/stop", path))
    )


def validate_body(path, body):
    if path != "/v1/runs":
        return
    payload = json.loads(body)
    if not isinstance(payload, dict) or set(payload) - {
        "input",
        "instructions",
        "session_id",
    }:
        raise ValueError("Only text runs are enabled")
    if (
        not isinstance(payload.get("input"), str)
        or not 1 <= len(payload["input"]) <= 131072
    ):
        raise ValueError("Text input required")
    for field, limit in (("instructions", 32768), ("session_id", 256)):
        if field in payload and (
            not isinstance(payload[field], str) or len(payload[field]) > limit
        ):
            raise ValueError("Invalid field")


class UnixConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(SOCKET)


class BridgeHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def forward(self):
        connection = None
        started = False
        try:
            if not allowed(self.command, self.path):
                self.send_error(403, "Endpoint disabled")
                return
            if self.server.native_side:
                key = Path(KEY_FILE).read_text().strip()
                if not hmac.compare_digest(
                    self.headers.get("Authorization", ""), "Bearer " + key
                ):
                    self.send_error(401, "Authentication required")
                    return
            size = int(self.headers.get("Content-Length", "0"))
            if self.headers.get("Transfer-Encoding") or not 0 <= size <= 262144:
                self.send_error(413)
                return
            self.connection.settimeout(30)
            body = self.rfile.read(size)
            if len(body) != size:
                raise ValueError("Incomplete request")
            if self.command == "POST":
                validate_body(self.path, body)
            if (
                not self.server.native_side
                and self.command == "POST"
                and self.path == "/v1/runs"
            ):
                capability_key = Path("/run/secrets/task-capability.key")
                if capability_key.exists():
                    from task_capability import persistent_issue

                    payload = json.loads(body)
                    capability = persistent_issue(
                        capability_key.read_bytes(),
                        self.headers.get("Idempotency-Key", ""),
                        "/state/task-capabilities.sqlite3",
                    )
                    payload["instructions"] = payload.get("instructions", "") + (
                        "\nДоверенная настройка запуска: отвечай пользователю по-русски. "
                        "После выполнения задачи вызови mcp_paperclip_task_submit_result, "
                        "записав краткий результат по-русски. Это передаёт задачу пользователю на проверку. "
                        "Не утверждай, что статус изменён, если инструмент вернул ошибку. "
                        "Не публикуй capability в ответах или комментариях. "
                        "Используй только эту capability для локальных task-инструментов: "
                        + capability
                    )
                    body = json.dumps(payload).encode()
            if self.server.native_side:
                connection = http.client.HTTPConnection("127.0.0.1", 8643, timeout=900)
            else:
                connection = UnixConnection("hermes-runtime", timeout=900)
            headers = {
                "Content-Type": "application/json",
                "Authorization": self.headers.get("Authorization", ""),
            }
            for name in ("Idempotency-Key", "X-Hermes-Session-Key"):
                if value := self.headers.get(name):
                    headers[name] = value
            connection.request(
                self.command, self.path, body=body or None, headers=headers
            )
            response = connection.getresponse()
            self.send_response(response.status)
            self.send_header(
                "Content-Type", response.getheader("Content-Type", "application/json")
            )
            self.send_header("Connection", "close")
            self.end_headers()
            started = True
            while chunk := response.read1(65536):
                self.wfile.write(chunk)
                self.wfile.flush()
        except (ValueError, json.JSONDecodeError):
            if not started:
                self.send_error(400, "Invalid text request")
        except Exception:
            if not started:
                self.send_error(502, "Hermes API unavailable")
        finally:
            self.close_connection = True
            if connection:
                connection.close()

    do_GET = forward
    do_POST = forward
    do_PUT = forward
    do_DELETE = forward
    do_CONNECT = forward


class UnixServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    native_side = True


def native_bridge():
    Path(SOCKET).unlink(missing_ok=True)
    server = UnixServer(SOCKET, BridgeHandler)
    os.chmod(SOCKET, 0o600)
    return server


def main():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 8642), BridgeHandler)
    server.native_side = False
    server.daemon_threads = True
    print("Paperclip loopback bridge listening on 127.0.0.1:8642", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
