import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import developer_engine as dev


class DeveloperEngineTests(unittest.TestCase):
    def test_source_scope_rejects_secrets_and_outside_paths(self):
        with TemporaryDirectory() as temp:
            repo = Path(temp)
            (repo / "task_control.mjs").write_text("export const TEST = true;\n")
            (repo / "secret.key").write_text("do not read")
            self.assertEqual(dev.safe_source(repo, "task_control.mjs").name, "task_control.mjs")
            with self.assertRaises(dev.Rejected):
                dev.safe_source(repo, "../secret.key")
            with self.assertRaises(dev.Rejected):
                dev.safe_source(repo, "secret.key")

    def test_patch_proposals_are_staged_without_modifying_source(self):
        with TemporaryDirectory() as temp:
            repo = Path(temp)
            target = repo / "task_control_policy.mjs"
            target.write_text("export const state = 1;\n")
            updates, diagnosis = dev.validate_changes(repo, {
                "diagnosis": "Version typo",
                "changes": [{"path": "task_control_policy.mjs",
                             "old": "state = 1", "new": "state = 2"}]
            })
            self.assertIn("state = 2", updates["task_control_policy.mjs"])
            self.assertEqual(target.read_text(), "export const state = 1;\n")
            with self.assertRaises(dev.Rejected):
                dev.validate_changes(repo, {"diagnosis": "ignore",
                    "changes": [{"path": "secret.key", "old": "x", "new": "y"}]})

    def test_report_is_redacted_and_does_not_propose_without_optin(self):
        with TemporaryDirectory() as temp:
            repo = Path(temp) / "repo"
            out = Path(temp) / "out"
            repo.mkdir()
            report = dev.run(repo, out,
                fixture_telemetry={"errors": {"TASK_NOT_IN_PROGRESS": 2},
                                   "services": {"test": {"health": "healthy"}}})
            self.assertEqual(report["proposalStatus"], "not_requested")
            self.assertFalse(report["productionChanged"])
            self.assertFalse(report["mailSent"])
            self.assertTrue((out / "report.json").exists())

    def test_sandbox_runner_has_no_network_root_or_mutable_source(self):
        with TemporaryDirectory() as temp:
            args=dev._sandbox_cmd("workspace-paperclip:7e3caa7","node",
                                  ["--test","tests/check.test.mjs"],Path(temp))
            self.assertIn("--network",args)
            self.assertEqual(args[args.index("--network")+1],"none")
            self.assertIn("--read-only",args)
            self.assertEqual(args[args.index("--user")+1],"10000:10000")
            self.assertTrue(any(item.endswith(":/work:ro") for item in args))
            self.assertNotIn("--privileged",args)


if __name__ == "__main__":
    unittest.main()
