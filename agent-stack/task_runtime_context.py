"""Inject the current run grant on the trusted side, never through model arguments."""

import copy
import json
import re
import threading
from contextlib import contextmanager

TAG = re.compile(r"\[\[workspace-task-grant:([0-9a-f-]{36}:[0-9]{10}:[0-9a-f]{64})\]\]")


def extract_grant(prompt):
    if not isinstance(prompt, str):
        raise RuntimeError("Trusted task context missing")
    matches = list(TAG.finditer(prompt))
    if not matches:
        raise RuntimeError("Trusted task grant missing")
    return TAG.sub("", prompt), matches[-1].group(1)


class TaskBindings:
    def __init__(self):
        self._active = {}
        self._lock = threading.RLock()

    @contextmanager
    def bind(self, session_id, capability):
        if not isinstance(session_id, str) or not session_id:
            raise RuntimeError("Native session identity missing")
        with self._lock:
            if session_id in self._active:
                raise RuntimeError("Task session already active")
            self._active[session_id] = capability
        try:
            yield
        finally:
            with self._lock:
                self._active.pop(session_id, None)

    def wrap(self, original, method):
        def handler(arguments, **context):
            expected = set() if method == "current_task" else {"summary"}
            if not isinstance(arguments, dict) or set(arguments) != expected:
                return json.dumps(
                    {
                        "error": "Передавай только поля из схемы инструмента. Служебное разрешение подставляется автоматически."
                    }
                )
            if method == "submit_result" and (
                not isinstance(arguments.get("summary"), str)
                or not arguments["summary"].strip()
                or len(arguments["summary"]) > 8000
            ):
                return json.dumps({"error": "Нужен краткий непустой результат."})
            with self._lock:
                capability = self._active.get(context.get("session_id"))
            if not capability:
                return json.dumps(
                    {
                        "error": "Нет активного доверенного контекста задачи. Статус не изменён."
                    }
                )
            result = original({**arguments, "capability": capability}, **context)
            if not isinstance(result, str):
                return json.dumps(
                    {
                        "error": "Неожиданный ответ task-контроллера. Успех не подтверждён."
                    }
                )
            return result.replace(capability, "[служебное разрешение скрыто]")

        handler._workspace_task_bound = True
        return handler


def install_task_handlers(registry, bindings, name_for):
    for method in ("current_task", "submit_result"):
        name = name_for("paperclip_task", method)
        entry = registry.get_entry(name)
        if entry is not None and getattr(entry.handler, "_workspace_task_bound", False):
            continue
        if entry is None:
            raise RuntimeError("Scoped task tool missing")
        schema = copy.deepcopy(entry.schema)
        parameters = schema.setdefault("parameters", {})
        parameters.setdefault("properties", {}).pop("capability", None)
        parameters["required"] = [
            field for field in parameters.get("required", []) if field != "capability"
        ]
        parameters["additionalProperties"] = False
        schema["description"] = (
            "Проверить привязку текущей задачи. Без аргументов."
            if method == "current_task"
            else "Записать краткий результат по-русски и передать текущую задачу на проверку (in_review). Успех подтверждается ответом инструмента."
        )
        registry.register(
            name=name,
            toolset=entry.toolset,
            schema=schema,
            handler=bindings.wrap(entry.handler, method),
            check_fn=entry.check_fn,
            requires_env=entry.requires_env,
            is_async=False,
            description=schema["description"],
            emoji=entry.emoji,
            max_result_size_chars=entry.max_result_size_chars,
            execution_timeout=entry.execution_timeout,
            override=True,
        )
