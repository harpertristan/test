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
                    "--profile",
                    "interactive",
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

        self.assertTrue(config["networks"]["paperclip-web"]["internal"])
        self.assertNotIn(
            "paperclip-web", config["services"]["paperclip-db"]["networks"]
        )
        self.assertEqual(config["services"]["hermes"]["network_mode"], "none")


class HermesRuntimeComposeTests(unittest.TestCase):
    def test_runtime_network_none_and_only_loopback_bridge_has_panel_network(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            empty = base / "empty.env"
            empty.write_text("")
            panel = base / "panel.yaml"
            panel.write_text(
                (root / "compose.paperclip.yaml")
                .read_text()
                .replace("/srv/hermes-stack/private/paperclip-postgres.env", str(empty))
                .replace("/srv/hermes-stack/private/paperclip.env", str(empty))
            )
            command = [
                "docker",
                "compose",
                "-f",
                str(root / "compose.yaml"),
                "-f",
                str(panel),
                "-f",
                str(root / "compose.hermes-gateway.yaml"),
                "config",
                "--no-env-resolution",
                "--format",
                "json",
            ]
            config = json.loads(
                subprocess.run(
                    command, check=True, capture_output=True, text=True
                ).stdout
            )
        runtime = config["services"]["hermes-runtime"]
        self.assertEqual(runtime["network_mode"], "none")
        self.assertTrue(runtime["read_only"])
        self.assertNotIn("ports", runtime)
        sources = [v.get("source", "") for v in runtime["volumes"]]
        self.assertNotIn("/srv/hermes-stack/private/openai.key", sources)
        self.assertFalse(any("docker.sock" in source for source in sources))
        bridge = config["services"]["hermes-paperclip-bridge"]
        self.assertEqual(bridge["network_mode"], "service:paperclip")
        self.assertNotIn("ports", bridge)
        self.assertNotIn("networks", bridge)


class TaskControllerComposeTests(unittest.TestCase):
    def test_only_trusted_controller_gets_database_and_agent_key(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            empty = base / "empty.env"
            empty.write_text("")
            files = [str(root / "compose.yaml")]
            for filename in (
                "compose.paperclip.yaml",
                "compose.hermes-gateway.yaml",
                "compose.task-control.yaml",
            ):
                contents = (root / filename).read_text()
                for name in (
                    "paperclip-postgres.env",
                    "paperclip.env",
                    "task-control.env",
                ):
                    contents = contents.replace(
                        "/srv/hermes-stack/private/" + name, str(empty)
                    )
                path = base / filename
                path.write_text(contents)
                files.append(str(path))
            command = ["docker", "compose"]
            for filename in files:
                command += ["-f", filename]
            command += ["config", "--no-env-resolution", "--format", "json"]
            config = json.loads(
                subprocess.run(
                    command, check=True, capture_output=True, text=True
                ).stdout
            )
        runtime = config["services"]["hermes-runtime"]
        self.assertEqual(runtime["network_mode"], "none")
        sources = [v.get("source", "") for v in runtime["volumes"]]
        for forbidden in (
            "/srv/hermes-stack/private/task-control.json",
            "/srv/hermes-stack/private/task-capability.key",
            "/srv/hermes-stack/private/openai.key",
        ):
            self.assertNotIn(forbidden, sources)
        self.assertNotIn("DATABASE_URL", runtime.get("environment", {}))
        controller = config["services"]["task-control"]
        self.assertEqual(controller["network_mode"], "service:paperclip")
        self.assertTrue(controller["read_only"])
        self.assertNotIn("ports", controller)
        self.assertTrue(
            any(
                v.get("source") == "/srv/hermes-stack/private/task-control.json"
                for v in controller["volumes"]
            )
        )
