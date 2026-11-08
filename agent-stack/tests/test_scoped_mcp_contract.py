"""End-to-end local MCP dispatch contract, with the read sidecar mocked.

No network, Docker, Paperclip, credentials or real Scout data required.
"""
import json
import pathlib
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import task_control_mcp as mcp


class ScopedMcpTests(unittest.TestCase):
    def test_scoped_scout_read_forwards_exact_operation(self):
        with patch.object(mcp, "read_tool", return_value={
            "operation": "scout_findings", "data": [{"id": 1}]
        }) as backend:
            response = mcp.dispatch("tools/call", {
                "name": "scout_read",
                "arguments": {"capability": "synthetic-token",
                              "operation": "scout_findings", "params": {}}
            })
        backend.assert_called_once_with("synthetic-token", "scout_findings", {})
        self.assertEqual(response["isError"], False)
        self.assertEqual(json.loads(response["content"][0]["text"])["operation"],
                         "scout_findings")

    def test_denied_scout_read_is_mcp_error(self):
        with patch.object(mcp, "read_tool", return_value={
            "error": "Чтение не разрешено", "code": "TASK_NOT_AUTHORIZED"
        }):
            response = mcp.dispatch("tools/call", {
                "name": "scout_read",
                "arguments": {"capability": "synthetic-token",
                              "operation": "scout_findings", "params": {}}
            })
        self.assertTrue(response["isError"])
        self.assertEqual(json.loads(response["content"][0]["text"])["code"],
                         "TASK_NOT_AUTHORIZED")

    def test_no_unapproved_write_or_host_tool(self):
        for name in ("scout_start", "shell", "exec", "http_get", "filesystem_read"):
            with self.subTest(name=name):
                with self.assertRaises(ValueError):
                    mcp.dispatch("tools/call", {"name": name, "arguments": {}})

    def test_rejects_extra_arguments_and_cross_service_operation(self):
        with self.assertRaises(ValueError):
            mcp.dispatch("tools/call", {"name": "scout_read", "arguments": {
                "capability": "synthetic-token", "operation": "mail_messages",
                "params": {}}})
        with self.assertRaises(ValueError):
            mcp.dispatch("tools/call", {"name": "scout_read", "arguments": {
                "capability": "synthetic-token", "operation": "scout_findings",
                "params": {}, "url": "https://example.com"}})


if __name__ == "__main__":
    unittest.main()
