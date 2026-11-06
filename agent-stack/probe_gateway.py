"""Local policy check. Does not contact OpenAI or transmit any user data."""
import http.client
import socket


class Local(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(5)
        self.sock.connect("/run/model-bridge/openai.sock")


for method, path, expected in [
    ("GET", "/health", 200),
    ("GET", "/v1/models", 200),
    ("POST", "/v1/files", 403),
    ("POST", "/send-mail", 403),
    ("POST", "https://example.com/", 403),
]:
    connection = Local("local", timeout=5)
    try:
        connection.request(method, path, body="{}" if method == "POST" else None)
        response = connection.getresponse()
        response.read()
        if response.status != expected:
            raise SystemExit(f"FAIL: {method} {path}: {response.status}")
        print(f"OK: {method} {path}: {expected}")
    finally:
        connection.close()
print("Проверка шлюза завершена. Запросов в OpenAI не было.")
