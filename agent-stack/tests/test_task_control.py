import json
from pathlib import Path
import subprocess
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from task_capability import issue
from prepare_task_control import CONFIG


class TaskControlTests(unittest.TestCase):
    def test_python_grants_match_node_verifier(self):
        root = Path(__file__).resolve().parents[1]
        key = b"synthetic-test-key"
        run_id = "11111111-1111-4111-8111-111111111111"
        capability = issue(key, run_id, now=1800000000)
        program = f"""import {{verifyCapability}} from {json.dumps((root / "task_control_policy.mjs").as_uri())};
console.log(verifyCapability(Buffer.from('synthetic-test-key'),{json.dumps(capability)},1800000000));"""
        result = subprocess.run(
            ["node", "--input-type=module", "-e", program],
            capture_output=True,
            text=True,
            check=True,
        )
        self.assertEqual(result.stdout.strip(), run_id)
        with self.assertRaises(ValueError):
            issue(key, "https://example.com", now=1800000000)

    def test_only_two_mcp_methods_are_configured(self):
        import yaml

        config = yaml.safe_load(CONFIG)
        self.assertEqual(config["platform_toolsets"]["api_server"], ["paperclip_task"])
        self.assertEqual(set(config["mcp_servers"]), {"paperclip_task"})
        server = config["mcp_servers"]["paperclip_task"]
        self.assertEqual(server["tools"]["include"], ["current_task", "submit_result"])
        self.assertEqual(server["command"], "/opt/hermes/.venv/bin/python")
        self.assertNotIn("url", server)

    def test_grant_is_stable_across_bridge_retries_and_restarts(self):
        import tempfile
        from task_capability import persistent_issue

        with tempfile.TemporaryDirectory() as directory:
            database = str(Path(directory) / "grants.sqlite3")
            run_id = "11111111-1111-4111-8111-111111111111"
            first = persistent_issue(b"synthetic", run_id, database, now=1800000000)
            self.assertEqual(
                first, persistent_issue(b"synthetic", run_id, database, now=1800000100)
            )
            with self.assertRaises(ValueError):
                persistent_issue(b"synthetic", run_id, database, now=1800001801)

    def test_install_failure_restores_previous_runtime_without_relaxing_policy(self):
        import contextlib
        import io
        import tempfile
        from unittest.mock import patch
        import install_task_control as install

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "config").mkdir()
            config = root / "config/hermes-gateway.yaml"
            config.write_text("previous-text-only-config")
            with (
                patch.object(install, "ROOT", root),
                patch.object(install, "prepare"),
                patch.object(install, "run", return_value=""),
                patch.object(
                    install, "up", side_effect=[RuntimeError("synthetic failure"), None]
                ) as up,
                contextlib.redirect_stdout(io.StringIO()),
                self.assertRaisesRegex(RuntimeError, "восстановлен"),
            ):
                install.main()
            self.assertEqual(config.read_text(), "previous-text-only-config")
            self.assertEqual(up.call_args_list[-1].args[0], install.PREVIOUS)
