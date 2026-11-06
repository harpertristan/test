import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import launch_hermes
from model_proxy import Gateway, NoRedirect, UPSTREAM, validate


class PolicyTests(unittest.TestCase):
    def payload(self, **changes):
        return {
            "model": "gpt-4o-mini",
            "messages": [{"role": "user", "content": "Synthetic test"}],
            **changes,
        }

    def test_text_chat_forces_no_storage_and_output_limit(self):
        result = validate(self.payload(), ["gpt-4o-mini"])
        self.assertIs(result["store"], False)
        self.assertEqual(result["max_tokens"], 4096)

    def test_external_tools_and_image_urls_are_rejected(self):
        for change in [
            {"tools": [{"type": "web_search"}]},
            {
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {"url": "https://example.com/private"},
                            }
                        ],
                    }
                ]
            },
            {"base_url": "https://example.com"},
            {"store": True},
            {"model": "unapproved-model"},
            {"max_tokens": 999999},
        ]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate(self.payload(**change), ["gpt-4o-mini"])

    def test_client_function_tools_remain_usable(self):
        tools = [
            {
                "type": "function",
                "function": {"name": "read_document", "parameters": {"type": "object"}},
            }
        ]
        self.assertEqual(
            validate(self.payload(tools=tools), ["gpt-4o-mini"])["tools"], tools
        )

    def test_redirects_are_not_followed(self):
        self.assertIsNone(
            NoRedirect().redirect_request(
                None, None, 302, "", {}, "https://example.com"
            )
        )


class FakeResponse(io.BytesIO):
    status = 200


class FakeOpenAI:
    def __init__(self):
        self.requests = []

    def open(self, request, timeout):
        self.requests.append(request)
        return FakeResponse(b'{"choices":[{"message":{"content":"Synthetic reply"}}]}')


class SocketTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / "model.sock")
        self.upstream = FakeOpenAI()
        self.server = Gateway(
            self.path, "sk-synthetic-secret", ("gpt-4o-mini",), self.upstream
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.socket_patch = patch.object(launch_hermes, "SOCKET", self.path)
        self.socket_patch.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.socket_patch.stop()
        self.temp.cleanup()

    def request(self, method, path, payload=None):
        connection = launch_hermes.UnixConnection("local", timeout=3)
        try:
            body = json.dumps(payload) if payload is not None else None
            connection.request(
                method,
                path,
                body,
                {
                    "Authorization": "Bearer attacker-controlled",
                    "Content-Type": "application/json",
                },
            )
            response = connection.getresponse()
            return response.status, response.read()
        finally:
            connection.close()

    def test_only_gateway_injects_upstream_key(self):
        status, reply = self.request(
            "POST",
            "/v1/chat/completions",
            {
                "model": "gpt-4o-mini",
                "messages": [{"role": "user", "content": "hello"}],
            },
        )
        self.assertEqual(status, 200)
        self.assertIn(b"Synthetic reply", reply)
        request = self.upstream.requests[0]
        self.assertEqual(request.full_url, UPSTREAM)
        self.assertEqual(
            request.get_header("Authorization"), "Bearer sk-synthetic-secret"
        )
        self.assertNotIn(b"sk-synthetic-secret", reply)
        self.assertFalse(json.loads(request.data)["store"])

    def test_forbidden_paths_never_reach_upstream(self):
        for path in [
            "/v1/files",
            "/v1/responses",
            "/send-mail",
            "https://example.com/",
            "/v1/chat/completions?url=https://example.com",
        ]:
            with self.subTest(path=path):
                status, _ = self.request("POST", path, {})
                self.assertEqual(status, 403)
        self.assertEqual(self.upstream.requests, [])

    def test_models_and_health_have_no_credentials(self):
        for path in ["/health", "/v1/models"]:
            status, reply = self.request("GET", path)
            self.assertEqual(status, 200)
            self.assertNotIn(b"sk-synthetic-secret", reply)
        self.assertEqual(self.upstream.requests, [])

    def test_model_policy_is_enforced_at_socket_boundary(self):
        status, _ = self.request(
            "POST",
            "/v1/chat/completions",
            {
                "model": "unapproved-model",
                "messages": [{"role": "user", "content": "hello"}],
            },
        )
        self.assertEqual(status, 400)
        self.assertEqual(self.upstream.requests, [])


if __name__ == "__main__":
    unittest.main()


class PersistentQuotaTests(unittest.TestCase):
    def test_daily_quota_survives_gateway_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            quota = str(base / "quota.sqlite3")
            with Gateway(
                str(base / "first.sock"),
                "synthetic",
                ("gpt-4o-mini",),
                quota_path=quota,
                daily_requests=200,
                daily_bytes=8 * 1024 * 1024,
            ) as first:
                self.assertTrue(first.allowed(4 * 1024 * 1024))
                self.assertTrue(first.allowed(4 * 1024 * 1024))
                self.assertFalse(first.allowed(1))
            with Gateway(
                str(base / "second.sock"),
                "synthetic",
                ("gpt-4o-mini",),
                quota_path=quota,
                daily_requests=200,
                daily_bytes=8 * 1024 * 1024,
            ) as second:
                self.assertFalse(second.allowed(1))


class HermesCompatibilityTests(unittest.TestCase):
    def test_custom_profile_reasoning_hint_is_not_forwarded_to_nonreasoning_model(self):
        payload = {
            "model": "gpt-4o-mini",
            "messages": [{"role": "user", "content": "Synthetic test"}],
            "reasoning_effort": "medium",
            "options": {"num_ctx": 64000},
            "prompt_cache_key": "synthetic-cache-key",
            "max_tokens": 16384,
        }
        result = validate(payload, ["gpt-4o-mini"])
        self.assertNotIn("reasoning_effort", result)
        self.assertNotIn("options", result)
        self.assertNotIn("prompt_cache_key", result)
        self.assertEqual(result["max_tokens"], 8192)
        self.assertFalse(result["store"])

    def test_local_options_cannot_smuggle_an_external_url(self):
        with self.assertRaises(ValueError):
            validate(
                {
                    "model": "gpt-4o-mini",
                    "messages": [{"role": "user", "content": "test"}],
                    "options": {"num_ctx": 64000, "url": "https://example.com"},
                },
                ["gpt-4o-mini"],
            )
