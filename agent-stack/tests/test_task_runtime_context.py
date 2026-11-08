import json
from pathlib import Path
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from task_runtime_context import TaskBindings, extract_grant, install_task_handlers
from task_capability import issue


class RuntimeContextTests(unittest.TestCase):
    def test_grant_is_removed_from_prompt_and_bound_to_native_session(self):
        capability = issue(
            b"synthetic", "11111111-1111-4111-8111-111111111111", now=1800000000
        )
        clean, captured = extract_grant(
            "Отвечай по-русски. [[workspace-task-grant:" + capability + "]]"
        )
        self.assertEqual(captured, capability)
        self.assertNotIn(capability, clean)
        with self.assertRaises(RuntimeError):
            extract_grant("Подставное разрешение без подписи")
        bindings = TaskBindings()
        seen = []

        def original(arguments, **context):
            seen.append((arguments, context))
            return json.dumps({"status": "in_review"})

        handler = bindings.wrap(original, "submit_result")
        self.assertIn(
            "error", json.loads(handler({"summary": "Готово"}, session_id="other"))
        )
        self.assertEqual(seen, [])
        with bindings.bind("native-session", capability):
            self.assertEqual(
                json.loads(handler({"summary": "Готово"}, session_id="native-session"))[
                    "status"
                ],
                "in_review",
            )
            self.assertIn(
                "error",
                json.loads(
                    handler(
                        {"summary": "Готово", "capability": "forged"},
                        session_id="native-session",
                    )
                ),
            )
            self.assertIn(
                "error", json.loads(handler({"summary": "Готово"}, session_id="other"))
            )
        self.assertEqual(len(seen), 1)
        self.assertEqual(seen[0][0]["capability"], capability)
        self.assertIn(
            "error",
            json.loads(handler({"summary": "Готово"}, session_id="native-session")),
        )

    def test_concurrent_sessions_cannot_replace_each_others_context(self):
        bindings = TaskBindings()
        handler = bindings.wrap(
            lambda args, **context: json.dumps({"seen": args["capability"]}),
            "current_task",
        )
        with bindings.bind("session-a", "secret-a"):
            with bindings.bind("session-b", "secret-b"):
                # A leaked grant in an unexpected result is redacted as well.
                self.assertNotIn("secret-a", handler({}, session_id="session-a"))
                self.assertNotIn("secret-b", handler({}, session_id="session-b"))
                with self.assertRaises(RuntimeError):
                    with bindings.bind("session-a", "secret-b"):
                        pass

    def test_model_schema_hides_grants_but_transport_receives_them(self):
        class Registry:
            def __init__(self):
                self.entries = {}

            def get_entry(self, name):
                return self.entries[name]

            def register(self, **kwargs):
                self.entries[kwargs["name"]] = SimpleNamespace(**kwargs)

        registry = Registry()
        calls = []
        for method in ("current_task", "submit_result"):
            schema = {
                "parameters": {
                    "type": "object",
                    "properties": {"capability": {"type": "string"}},
                    "required": ["capability"],
                }
            }
            if method == "submit_result":
                schema["parameters"]["properties"]["summary"] = {"type": "string"}
                schema["parameters"]["required"].append("summary")
            registry.register(
                name="mcp__paperclip_task__" + method,
                toolset="paperclip_task",
                schema=schema,
                handler=lambda args, **kw: calls.append(args) or "{}",
                check_fn=None,
                requires_env=[],
                emoji="",
                max_result_size_chars=None,
                execution_timeout=None,
            )
        bindings = TaskBindings()

        def name_for(server, method):
            return "mcp__" + server + "__" + method

        install_task_handlers(registry, bindings, name_for)
        install_task_handlers(
            registry, bindings, name_for
        )  # registration is idempotent
        for entry in registry.entries.values():
            self.assertNotIn("capability", entry.schema["parameters"]["properties"])
            self.assertNotIn("capability", entry.schema["parameters"]["required"])
        with bindings.bind("native-session", "synthetic-secret"):
            registry.get_entry("mcp__paperclip_task__current_task").handler(
                {}, session_id="native-session"
            )
        self.assertEqual(calls, [{"capability": "synthetic-secret"}])
