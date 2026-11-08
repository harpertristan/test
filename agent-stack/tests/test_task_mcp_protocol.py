import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import task_control_mcp as mcp


class StdioMcpTests(unittest.TestCase):
    def test_real_stdio_initialization_notifications_and_two_tools_without_sdk(self):
        messages = [
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-11-25",
                    "clientInfo": {"name": "test", "version": "1"},
                },
            },
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
            {"jsonrpc": "2.0", "id": 3, "method": "ping"},
        ]
        result = subprocess.run(
            [sys.executable, str(Path(mcp.__file__))],
            input="".join(json.dumps(m) + "\n" for m in messages),
            capture_output=True,
            text=True,
            check=True,
        )
        responses = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual([m["id"] for m in responses], [1, 2, 3])
        self.assertEqual(responses[0]["result"]["protocolVersion"], "2025-11-25")
        self.assertEqual(
            {t["name"] for t in responses[1]["result"]["tools"]},
            {"current_task", "submit_result"},
        )
        self.assertEqual(result.stderr, "")

    def test_calls_are_narrow_and_failures_are_not_reported_as_success(self):
        with patch.object(mcp, "call", return_value={"status": "in_review"}) as call:
            result = mcp.dispatch(
                "tools/call",
                {
                    "name": "submit_result",
                    "arguments": {
                        "capability": "synthetic",
                        "summary": "Готово для проверки",
                    },
                },
            )
            self.assertFalse(result["isError"])
            self.assertEqual(call.call_args.args[0], "/submit")
        with patch.object(mcp, "call", return_value={"error": "refused"}):
            self.assertTrue(
                mcp.dispatch(
                    "tools/call",
                    {"name": "current_task", "arguments": {"capability": "synthetic"}},
                )["isError"]
            )
        with patch.object(mcp, "call") as call:
            for arguments in (
                {"capability": "x", "task_id": "other"},
                {"capability": "x", "url": "https://example.com"},
            ):
                with self.assertRaises(ValueError):
                    mcp.dispatch(
                        "tools/call", {"name": "current_task", "arguments": arguments}
                    )
            call.assert_not_called()

    def test_install_is_not_started_without_exact_compatibility_pass(self):
        import contextlib
        import io
        import diagnose_task_control as diagnose
        import install_task_control as install

        with (
            patch.object(
                diagnose, "run", return_value="Exact two-tool contract: FAIL\n"
            ),
            patch.object(diagnose.sys, "argv", ["diagnose", "--install-if-compatible"]),
            patch.object(install, "main") as main,
            contextlib.redirect_stdout(io.StringIO()),
            self.assertRaises(RuntimeError),
        ):
            diagnose.main()
        main.assert_not_called()
