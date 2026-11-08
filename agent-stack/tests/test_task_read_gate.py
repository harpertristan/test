"""Tests that a failed Scout read cannot turn a task into an in_review success."""
import json
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from task_runtime_context import TaskBindings, _verified_read_result


def mcp_response(payload, error=False):
    return json.dumps({"content": [{"type": "text", "text": json.dumps(payload)}],
                       "isError": error})


class TaskReadGateTests(unittest.TestCase):
    def setUp(self):
        self.bindings = TaskBindings()
        self.calls = []
        self.capability = "synthetic-not-a-real-grant"
        self.operation = "scout_findings"

    def execute(self, result, session="session-a", perform_read=True):
        def provider(arguments, **context):
            self.calls.append(("read", arguments))
            return result

        def submit(arguments, **context):
            self.calls.append(("submit", arguments))
            return json.dumps({"status": "in_review"})

        read = self.bindings.wrap(provider, "scout_read")
        finish = self.bindings.wrap(submit, "submit_result")
        if perform_read:
            read({"operation": self.operation, "params": {}}, session_id=session)
        return json.loads(finish({"summary": "Итоги проверки"}, session_id=session))

    def test_successful_verified_read_allows_review(self):
        with self.bindings.bind("session-a", self.capability):
            outcome = self.execute(mcp_response({"operation": self.operation, "data": []}))
        self.assertEqual(outcome["status"], "in_review")
        self.assertEqual([kind for kind, _ in self.calls], ["read", "submit"])

    def test_denied_or_unavailable_read_blocks_review(self):
        for result in [
            mcp_response({"error": "READ_REFUSED", "code": "TASK_NOT_AUTHORIZED"}, True),
            mcp_response({"error": "READ_UNAVAILABLE"}),
            "not-json",
            mcp_response({"operation": "scout_candidates", "data": []}),
        ]:
            with self.subTest(result=result):
                self.calls.clear()
                with self.bindings.bind("session-a", self.capability):
                    outcome = self.execute(result)
                self.assertEqual(outcome["code"], "READ_EVIDENCE_MISSING")
                self.assertEqual([kind for kind, _ in self.calls], ["read"])

    def test_missing_read_blocks_review(self):
        with self.bindings.bind("session-a", self.capability):
            outcome = self.execute("", perform_read=False)
        self.assertEqual(outcome["code"], "READ_EVIDENCE_MISSING")
        self.assertEqual(self.calls, [])

    def test_read_evidence_cannot_cross_sessions_or_survive_finish(self):
        with self.bindings.bind("session-a", self.capability):
            self.execute(mcp_response({"operation": self.operation, "data": []}))
        self.calls.clear()
        with self.bindings.bind("session-b", self.capability):
            outcome = self.execute("", session="session-b", perform_read=False)
            self.assertEqual(outcome["code"], "READ_EVIDENCE_MISSING")
        with self.bindings.bind("session-a", self.capability):
            outcome = self.execute("", perform_read=False)
        self.assertEqual(outcome["code"], "READ_EVIDENCE_MISSING")

    def test_malformed_mcp_envelope_is_never_trusted(self):
        self.assertFalse(_verified_read_result(
            mcp_response({"operation": self.operation, "data": []}, error=True),
            self.operation))
        self.assertFalse(_verified_read_result(
            json.dumps({"operation": self.operation, "error": "bad", "data": []}),
            self.operation))


if __name__ == "__main__":
    unittest.main()
