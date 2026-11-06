"""Check Docker Compose's parsed tmpfs mount list, not just YAML validity."""
import json
from pathlib import Path
import subprocess
import unittest


class ComposeMountTests(unittest.TestCase):
    def test_each_tmpfs_entry_is_one_absolute_mount(self):
        root = Path(__file__).resolve().parents[1]
        result = subprocess.run(
            ["docker", "compose", "-f", str(root / "compose.yaml"), "config", "--format", "json"],
            check=True, capture_output=True, text=True,
        )
        services = json.loads(result.stdout)["services"]
        for service in services.values():
            mounts = service.get("tmpfs", [])
            self.assertEqual(len(mounts), 1)
            self.assertTrue(mounts[0].startswith("/tmp:"))
            self.assertIn(",nodev,", mounts[0])
            self.assertIn(",noexec,", mounts[0])
