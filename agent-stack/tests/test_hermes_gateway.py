import contextlib
import http.client
import http.server
import io
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import hermes_gateway_bridge as bridge
import prepare_hermes_gateway as prepare


class GatewayPolicyTests(unittest.TestCase):
    def test_only_native_run_api_exposed(self):
        for method, path in [
            ("GET", "/health"),
            ("POST", "/v1/runs"),
            ("GET", "/v1/runs/abc-1/events"),
            ("POST", "/v1/runs/abc-1/stop"),
        ]:
            self.assertTrue(bridge.allowed(method, path))
        for method, path in [
            ("GET", "/api/sessions"),
            ("POST", "/api/jobs"),
            ("POST", "/v1/runs/abc/approval"),
            ("POST", "/v1/files"),
            ("CONNECT", "example.com:443"),
            ("GET", "https://example.com/"),
            ("GET", "/v1/runs/../config"),
            ("GET", "/health?url=https://example.com"),
        ]:
            self.assertFalse(bridge.allowed(method, path))

    def test_run_cannot_override_provider_tools_or_destination(self):
        bridge.validate_body("/v1/runs", b'{"input":"synthetic test"}')
        for body in [
            b'{"input":"test","provider":"other"}',
            b'{"input":"test","base_url":"https://example.com"}',
            b'{"input":"test","tools":["terminal"]}',
            b'{"input":[{"type":"image_url"}]}',
        ]:
            with self.assertRaises(ValueError):
                bridge.validate_body("/v1/runs", body)

    def test_private_socket_requires_auth_and_blocks_other_endpoints(self):
        class FakeNative(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"status":"ok"}')

        native = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FakeNative)
        threading.Thread(target=native.serve_forever, daemon=True).start()
        real_connection = http.client.HTTPConnection
        with tempfile.TemporaryDirectory() as directory:
            key = Path(directory) / "key"
            key.write_text("synthetic-private-key")
            socket = str(Path(directory) / "runtime.sock")
            with (
                patch.object(bridge, "KEY_FILE", str(key)),
                patch.object(bridge, "SOCKET", socket),
                patch.object(
                    bridge.http.client,
                    "HTTPConnection",
                    side_effect=lambda *args, **kwargs: real_connection(
                        "127.0.0.1", native.server_port, timeout=5
                    ),
                ),
            ):
                server = bridge.native_bridge()
                threading.Thread(target=server.serve_forever, daemon=True).start()
                try:
                    self.assertEqual(os.stat(socket).st_mode & 0o777, 0o600)
                    for method, path, auth, expected in [
                        ("GET", "/health", "", 401),
                        ("GET", "/health", "Bearer synthetic-private-key", 200),
                        ("POST", "/api/jobs", "Bearer synthetic-private-key", 403),
                    ]:
                        connection = bridge.UnixConnection("runtime", timeout=5)
                        connection.request(
                            method, path, headers={"Authorization": auth}
                        )
                        response = connection.getresponse()
                        self.assertEqual(response.status, expected)
                        response.read()
                        connection.close()
                finally:
                    server.shutdown()
                    server.server_close()
        native.shutdown()
        native.server_close()

    def test_preparation_preserves_key_and_does_not_print_it(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "private").mkdir()
            (root / "config").mkdir()
            output = io.StringIO()
            with (
                patch.object(prepare, "ROOT", root),
                patch.object(prepare.os, "geteuid", return_value=0),
                patch.object(prepare.os, "chown"),
                contextlib.redirect_stdout(output),
            ):
                prepare.main()
                key = (root / "private/hermes-gateway.key").read_text()
                prepare.main()
            self.assertEqual((root / "private/hermes-gateway.key").read_text(), key)
            self.assertNotIn(key.strip(), output.getvalue())
            self.assertEqual(
                (root / "private/hermes-gateway.key").stat().st_mode & 0o777, 0o400
            )
            self.assertIn(
                "api_server: []", (root / "config/hermes-gateway.yaml").read_text()
            )
