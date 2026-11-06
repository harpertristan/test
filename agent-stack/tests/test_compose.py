"""Check Docker Compose's parsed tmpfs mount list, not just YAML validity."""

import json
from pathlib import Path
import subprocess
import unittest
import tempfile


class ComposeMountTests(unittest.TestCase):
    def test_each_tmpfs_entry_is_one_absolute_mount(self):
        root = Path(__file__).resolve().parents[1]
        result = subprocess.run(
            [
                "docker",
                "compose",
                "-f",
                str(root / "compose.yaml"),
                "config",
                "--format",
                "json",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        services = json.loads(result.stdout)["services"]
        for service in services.values():
            mounts = service.get("tmpfs", [])
            self.assertEqual(len(mounts), 1)
            self.assertTrue(mounts[0].startswith("/tmp:"))
            self.assertIn(",nodev,", mounts[0])
            self.assertIn(",noexec,", mounts[0])


class PaperclipComposeTests(unittest.TestCase):
    def test_panel_is_private_and_cannot_access_model_gateway_network(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            environment = base / "empty.env"
            environment.write_text("")
            overlay = base / "paperclip.yaml"
            overlay.write_text(
                (root / "compose.paperclip.yaml")
                .read_text()
                .replace(
                    "/srv/hermes-stack/private/paperclip-postgres.env", str(environment)
                )
                .replace("/srv/hermes-stack/private/paperclip.env", str(environment))
            )
            result = subprocess.run(
                [
                    "docker",
                    "compose",
                    "-f",
                    str(root / "compose.yaml"),
                    "-f",
                    str(overlay),
                    "config",
                    "--no-env-resolution",
                    "--format",
                    "json",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
        config = json.loads(result.stdout)
        app = config["services"]["paperclip"]
        self.assertEqual(app["user"], "1000:1000")
        self.assertTrue(app["read_only"])
        self.assertEqual(
            app["environment"]["PAPERCLIP_DEPLOYMENT_MODE"], "authenticated"
        )
        self.assertEqual(app["environment"]["PAPERCLIP_AUTH_DISABLE_SIGN_UP"], "true")
        self.assertEqual(app["environment"]["PAPERCLIP_TELEMETRY_DISABLED"], "1")
        self.assertEqual(app["environment"]["HEARTBEAT_SCHEDULER_ENABLED"], "false")
        self.assertEqual(app["ports"][0]["host_ip"], "127.0.0.1")
        self.assertNotIn("model-egress", app["networks"])
        self.assertTrue(config["networks"]["paperclip-control"]["internal"])
        self.assertEqual(app["tmpfs"], ["/tmp:rw,nosuid,nodev,noexec,size=512m"])
