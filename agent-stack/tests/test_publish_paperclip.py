import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import publish_paperclip as publish


class PublicationTests(unittest.TestCase):
    def test_append_preserves_routes_and_is_idempotent(self):
        original = "{$SCOUT_DOMAIN} {\n reverse_proxy old-app:3000\n}\n"
        result = publish.append_panel(original, publish.DEFAULT_DOMAIN)
        self.assertTrue(result.startswith(original))
        self.assertEqual(publish.append_panel(result, publish.DEFAULT_DOMAIN), result)
        self.assertIn("reverse_proxy paperclip-panel:3100", result)
        with self.assertRaises(ValueError):
            publish.append_panel(result, "other.example.com")

    def test_domain_cannot_inject_caddy_or_environment(self):
        for domain in [
            "https://example.com",
            "a.com\nOTHER=1",
            "a.com {",
            "a.com/path",
        ]:
            with self.assertRaises(ValueError):
                publish.panel_environment("", domain)

    def test_environment_preserves_unrelated_settings(self):
        original = "OTHER=keep\nPAPERCLIP_PANEL_ORIGIN=http://localhost:3101\n"
        result = publish.panel_environment(original, publish.DEFAULT_DOMAIN)
        self.assertIn("OTHER=keep\n", result)
        self.assertEqual(result.count("PAPERCLIP_PANEL_ORIGIN="), 1)
        self.assertIn("https://" + publish.DEFAULT_DOMAIN, result)

    def test_failed_reload_restores_previous_routes_and_panel_settings(self):
        import contextlib
        import io
        import json
        import tempfile
        from unittest.mock import patch

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "private").mkdir()
            caddy = root / "Caddyfile"
            original = "old.example.com {\n reverse_proxy old-app:3000\n}\n"
            caddy.write_text(original)
            environment = root / ".env"
            environment.write_text("OTHER=preserve\n")
            info = {
                "Id": "caddy-id",
                "Mounts": [
                    {
                        "Destination": "/etc/caddy/Caddyfile",
                        "Type": "bind",
                        "Source": str(caddy),
                    }
                ],
            }

            def fake_run(command, **kwargs):
                if "inspect" in command and "network" not in command:
                    return json.dumps([info])
                if "network" in command and "inspect" in command:
                    return json.dumps(
                        [{"Internal": True, "Containers": {"caddy-id": {}}}]
                    )
                return ""

            with (
                patch.object(publish, "ROOT", root),
                patch.object(publish, "HERE", root),
                patch.object(publish.os, "geteuid", return_value=0),
                patch.object(
                    publish.socket,
                    "getaddrinfo",
                    return_value=[(None, None, None, None, ("34.22.184.67", 443))],
                ),
                patch.object(publish, "run", side_effect=fake_run),
                patch.object(publish, "start_panel") as start,
                patch.object(
                    publish, "reload_caddy", side_effect=[RuntimeError("failed"), None]
                ),
                contextlib.redirect_stdout(io.StringIO()),
                self.assertRaisesRegex(RuntimeError, "восстановлены"),
            ):
                publish.main(publish.DEFAULT_DOMAIN)
            self.assertEqual(caddy.read_text(), original)
            self.assertEqual(environment.read_text(), "OTHER=preserve\n")
            self.assertEqual(start.call_count, 2)
            self.assertEqual(
                len(list((root / "private").glob("panel-backup-*/Caddyfile"))), 1
            )
