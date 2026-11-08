"""Exercise only denied task requests and health. Never calls a model or changes a task."""

import http.client
import socket


class Connection(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect("/run/task-control/control.sock")


def main():
    for method, path, body, expected in [
        ("GET", "/health", None, 200),
        ("POST", "/current", '{"capability":"invalid"}', 403),
        ("POST", "/submit", '{"capability":"invalid","summary":"test"}', 403),
        ("POST", "/send-mail", "{}", 403),
        ("GET", "https://example.com/", None, 403),
    ]:
        connection = Connection("local", timeout=5)
        try:
            connection.request(method, path, body, {"Content-Type": "application/json"})
            response = connection.getresponse()
            response.read()
            if response.status != expected:
                raise RuntimeError("Task controller boundary check failed")
            print(f"OK: {method} {path}: {response.status}")
        finally:
            connection.close()
    print("Контроллер проверен: задачи не менялись, запросов в OpenAI не было.")


if __name__ == "__main__":
    main()
