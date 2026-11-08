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
        for name in ("shell", "exec", "http_get", "filesystem_read"):
            with self.subTest(name=name):
                with self.assertRaises(ValueError):
                    mcp.dispatch("tools/call", {"name": name, "arguments": {}})

    def test_scoped_start_requires_only_trusted_capability(self):
        with patch.object(mcp, "scout_start", return_value={
            "status": "accepted", "sourceCount": 2
        }) as backend:
            response = mcp.dispatch("tools/call", {
                "name": "scout_start",
                "arguments": {"capability": "synthetic-token"}
            })
        backend.assert_called_once_with(capability="synthetic-token")
        self.assertFalse(response["isError"])
        self.assertEqual(json.loads(response["content"][0]["text"])["status"], "accepted")
        with self.assertRaises(ValueError):
            mcp.dispatch("tools/call", {"name": "scout_start", "arguments": {
                "capability": "synthetic-token", "allowPaid": True
            }})


    def test_web_research_routes_exactly_and_rejects_upload(self):
        with patch.object(mcp, "web_research", return_value={
            "action": "open", "data": {"sourceUrl": "https://bank.example/",
                                      "title": "Bank"},
        }) as backend:
            response = mcp.dispatch("tools/call", {
                "name": "web_research",
                "arguments": {"capability": "synthetic-token",
                              "action": "open", "url": "https://bank.example/"}
            })
        self.assertFalse(response["isError"])
        backend.assert_called_once_with(capability="synthetic-token",
                                        action="open", url="https://bank.example/")
        with self.assertRaises(ValueError):
            mcp.dispatch("tools/call", {
                "name": "web_research",
                "arguments": {"capability": "synthetic-token", "action": "post",
                              "url": "https://bank.example/"}
            })
        with self.assertRaises(ValueError):
            mcp.dispatch("tools/call", {
                "name": "web_research",
                "arguments": {"capability": "synthetic-token", "action": "open",
                              "url": "https://bank.example/", "body": "SECRET"}
            })

    def test_native_begin_and_human_only_approval_never_send(self):
        with patch.object(mcp, "begin_task", return_value={
            "status": "in_progress", "checkoutConfirmed": True
        }) as begin:
            result = mcp.dispatch("tools/call", {"name": "begin_task",
                "arguments": {"capability": "synthetic-token"}})
        self.assertFalse(result["isError"])
        begin.assert_called_once()
        with patch.object(mcp, "request_approval", return_value={
            "status": "awaiting_human_approval", "executed": False
        }) as request:
            result = mcp.dispatch("tools/call", {
                "name": "request_approval",
                "arguments": {"capability": "synthetic-token", "action": "email_send",
                              "destination": "bank@example.com", "subject": "Question",
                              "details": "Please confirm fees."}
            })
        self.assertFalse(result["isError"])
        self.assertFalse(json.loads(result["content"][0]["text"])["executed"])
        request.assert_called_once()
        self.assertNotIn("send_mail", [tool["name"] for tool in mcp.TOOLS])

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
