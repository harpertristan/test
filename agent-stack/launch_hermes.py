"""Loopback HTTP -> Unix socket bridge; Hermes retains network_mode: none."""

import http.client
import http.server
import os
import socket
import subprocess
import sys
import threading

SOCKET = "/run/model-bridge/openai.sock"


class UnixConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(SOCKET)


class LocalHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def forward(self):
        connection = UnixConnection("model-gateway", timeout=100)
        started = False
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 <= size <= 1024 * 1024 or self.headers.get("Transfer-Encoding"):
                self.send_error(413)
                return
            body = self.rfile.read(size) if size else None
            connection.request(
                self.command,
                self.path,
                body=body,
                headers={"Content-Type": "application/json"},
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
        except Exception:
            if not started:
                self.send_error(502, "Model gateway unavailable")
        finally:
            connection.close()

    do_GET = forward
    do_POST = forward


def main():
    if not os.path.exists(SOCKET):
        raise SystemExit("Model gateway socket not ready; start model-proxy first")
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 18080), LocalHandler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        result = subprocess.run(
            ["/opt/hermes/.venv/bin/hermes", *(sys.argv[1:] or ["chat"])]
        )
        raise SystemExit(result.returncode)
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
