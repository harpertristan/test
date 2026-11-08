import contextlib
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import prepare


class PrepareTests(unittest.TestCase):
    def test_existing_crm_key_is_copied_only_to_gateway_secret(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "crm.env"
            key = "sk-synthetic-test-" + "x" * 30
            original = 'OPENAI_API_KEY="' + key + '"\nFERNET_KEY=untouched\n'
            source.write_text(original)
            output = io.StringIO()
            with (
                patch.object(prepare, "ROOT", root),
                patch.object(prepare, "SOURCE_ENV", source),
                patch.object(os, "geteuid", return_value=0),
                patch.object(os, "chown"),
                contextlib.redirect_stdout(output),
            ):
                prepare.main()
            self.assertEqual(source.read_text(), original)
            self.assertEqual((root / "private/openai.key").read_text().strip(), key)
            self.assertEqual(
                (root / "private/openai.key").stat().st_mode & 0o777, 0o400
            )
            self.assertNotIn(key, output.getvalue())
            config = (root / "config/hermes.yaml").read_text()
            self.assertNotIn(key, config)
            self.assertIn("127.0.0.1:18080", config)
            self.assertTrue((root / "state/model-proxy").is_dir())
            self.assertTrue((root / "state/hermes").is_dir())

    def test_existing_operator_config_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "private").mkdir()
            (root / "private/openai.key").write_text("sk-synthetic-test-" + "x" * 30)
            (root / "config").mkdir()
            config = root / "config/hermes.yaml"
            config.write_text("operator settings")
            with (
                patch.object(prepare, "ROOT", root),
                patch.object(os, "geteuid", return_value=0),
                self.assertRaises(SystemExit),
            ):
                prepare.main()
            self.assertEqual(config.read_text(), "operator settings")
