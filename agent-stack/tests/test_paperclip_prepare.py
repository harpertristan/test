import contextlib
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import prepare_paperclip


class PaperclipPrepareTests(unittest.TestCase):
    def test_setup_preserves_secrets_on_repeated_runs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = io.StringIO()
            with (
                patch.object(prepare_paperclip, "ROOT", root),
                patch.object(os, "geteuid", return_value=0),
                patch.object(os, "chown"),
                contextlib.redirect_stdout(output),
            ):
                prepare_paperclip.main()
                first = (root / "private/paperclip.env").read_text()
                prepare_paperclip.main()
            self.assertEqual(first, (root / "private/paperclip.env").read_text())
            self.assertIn("paperclip-db:5432/paperclip", first)
            for line in first.splitlines():
                self.assertNotIn(line.split("=", 1)[1], output.getvalue())
            self.assertEqual(
                (root / "private/paperclip.env").stat().st_mode & 0o777, 0o600
            )
            self.assertEqual((root / "state/paperclip").stat().st_mode & 0o777, 0o700)

    def test_mismatched_database_secrets_are_not_replaced(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "private").mkdir()
            (root / "private/paperclip-postgres.env").write_text(
                "POSTGRES_PASSWORD=existing-value\n"
            )
            application = root / "private/paperclip.env"
            application.write_text("operator settings")
            with (
                patch.object(prepare_paperclip, "ROOT", root),
                patch.object(os, "geteuid", return_value=0),
                self.assertRaises(SystemExit),
            ):
                prepare_paperclip.main()
            self.assertEqual(application.read_text(), "operator settings")
