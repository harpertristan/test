import contextlib
import io
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from diagnose_task_binding import inspect_calls
from task_capability import issue


class BindingDiagnosticTests(unittest.TestCase):
    def test_detects_copy_error_without_exposing_grants_or_task_text(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "private").mkdir()
            (root / "state/hermes-gateway").mkdir(parents=True)
            key = b"synthetic-signing-secret"
            (root / "private/task-capability.key").write_bytes(key)
            capability = issue(
                key, "11111111-1111-4111-8111-111111111111", now=1800000000
            )
            bad = capability[:-1] + ("a" if capability[-1] != "a" else "b")
            connection = sqlite3.connect(root / "state/hermes-gateway/state.db")
            connection.execute(
                "CREATE TABLE messages (id INTEGER, role TEXT, tool_calls TEXT)"
            )
            for index, token in enumerate([capability, bad]):
                calls = [
                    {
                        "function": {
                            "name": "mcp__paperclip_task__submit_result",
                            "arguments": json.dumps(
                                {"capability": token, "summary": "private task text"}
                            ),
                        }
                    }
                ]
                connection.execute(
                    "INSERT INTO messages VALUES (?,?,?)",
                    (index, "assistant", json.dumps(calls)),
                )
            connection.commit()
            connection.close()
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                inspect_calls(root)
            self.assertIn('"signatureValid": true', output.getvalue())
            self.assertIn('"signatureValid": false', output.getvalue())
            for secret in [capability, bad, key.decode(), "private task text"]:
                self.assertNotIn(secret, output.getvalue())
