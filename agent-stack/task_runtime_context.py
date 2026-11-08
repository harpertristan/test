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



def _verified_read_result(raw, operation):
    """Require a structured successful result from the trusted read sidecar."""
    if not isinstance(raw, str):
        return False
    try:
        value = json.loads(raw)
        if isinstance(value, dict) and value.get("operation") == operation:
            return "data" in value and "error" not in value
        if not isinstance(value, dict) or value.get("isError") is not False:
            return False
        content = value.get("content")
        if not isinstance(content, list):
            return False
        return any(
            isinstance(entry, dict)
            and entry.get("type") == "text"
            and _verified_read_result(entry.get("text"), operation)
            for entry in content
        )
    except (TypeError, ValueError, RecursionError):
        return False


def _verified_web_result(raw, action):
    if not isinstance(raw, str):
        return False
    try:
        value = json.loads(raw)
        if isinstance(value, dict) and value.get("action") == action:
            return "data" in value and "error" not in value
        if not isinstance(value, dict) or value.get("isError") is not False:
            return False
        return any(
            isinstance(part, dict) and part.get("type") == "text"
            and _verified_web_result(part.get("text"), action)
            for part in value.get("content", [])
        )
    except (ValueError, TypeError, RecursionError):
        return False

class TaskBindings:
    def __init__(self):
        self._active = {}
        self._lock = threading.RLock()
        self._successful_reads = {}

    @contextmanager
    def bind(self, session_id, capability):
        if not isinstance(session_id, str) or not session_id:
            raise RuntimeError("Native session identity missing")
        with self._lock:
            if session_id in self._active:
                raise RuntimeError("Task session already active")
            self._active[session_id] = capability
            self._successful_reads[session_id] = set()
        try:
            yield
        finally:
            with self._lock:
                self._active.pop(session_id, None)
                self._successful_reads.pop(session_id, None)

    def wrap(self, original, method):
        def handler(arguments, **context):
            expected = (
                set() if method in {"current_task", "begin_task", "scout_start", "developer_status", "operator_capabilities"}
                else {"source"} if method == "scout_collect"
                else {"reviewId", "decision", "sourceUrl", "evidence"} if method == "scout_crm_manage"
                else ({"action"} if arguments.get("action") in ("list", "reset")
                    else {"action", "path"} if arguments.get("action") == "read"
                    else {"action", "path", "old", "new"} if arguments.get("action") == "patch"
                    else {"action", "suite"} if arguments.get("suite") == "all_syntax"
                    else {"action", "suite", "path"}) if method == "developer_workspace"
                else {"summary"} if method == "submit_result"
                else {"action", "destination", "subject", "details"} if method == "request_approval"
                else ({"action"} if arguments.get("action") == "recall" else {"action", "lesson", "evidence"}) if method == "skills_memory"
                else ({"action", "query"} if arguments.get("action") == "search"
                      else {"action", "url"}) if method == "web_research"
                else {"operation", "params"}
            )
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
            if method == "submit_result":
                with self._lock:
                    has_verified_read = bool(self._successful_reads.get(context.get("session_id")))
                if not has_verified_read:
                    return json.dumps({
                        "error": "Нет подтверждённого успешного чтения данных. Результат не передан на проверку.",
                        "code": "READ_EVIDENCE_MISSING",
                    }, ensure_ascii=False)
            result = original({**arguments, "capability": capability}, **context)
            if method == "web_research" and _verified_web_result(
                result, arguments["action"]
            ):
                with self._lock:
                    if self._active.get(context.get("session_id")) == capability:
                        self._successful_reads[context["session_id"]].add("public_web")
            if method in {"scout_read", "assistant_read", "mail_crm_read"} and _verified_read_result(
                result, arguments["operation"]
            ):
                with self._lock:
                    if self._active.get(context.get("session_id")) == capability:
                        self._successful_reads[context["session_id"]].add(arguments["operation"])
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
    for method in ("current_task", "begin_task", "developer_status", "submit_result", "request_approval",
                   "web_research", "skills_memory", "scout_start", "scout_collect", "scout_crm_manage", "operator_capabilities", "developer_workspace", "scout_read", "assistant_read", "mail_crm_read"):
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
            else "Прочитать машинный отчёт Developer Engine, без запуска команд." if method == "developer_status"
            else "Взять назначенную задачу в работу штатным checkout; без аргументов." if method == "begin_task"
            else "Записать фактический результат и передать на проверку человеку." if method == "submit_result"
            else "Создать запрос на одобрение исходящего действия. Не отправляет данные и ничего не исполняет." if method == "request_approval"
            else "Исследовать публичный веб через Scout: search/query или open/url. Не отправляй приватные данные в поиск." if method == "web_research"
            else "Вспомни проверенные навыки (recall) или предложи новый (propose) с доказательством. Утверждает только оператор." if method == "skills_memory"
            else "Уточни у установленной системы фактические доступные операции и ограничения. Без аргументов." if method == "operator_capabilities"
            else "Рабочая изолированная копия кода: list/read/patch/test/reset; не меняет production и не выполняет shell." if method == "developer_workspace"
            else "Перенести найденного кандидата Play Scout из «На проверку» в «Подходит»/«Отсеяно»/«Наблюдать» после проверки официального источника." if method == "scout_crm_manage"
            else "Запустить один выбранный источник Play Scout по каталогу (play, web, watch, ecb, finextra, linkedin, facebook, sifted). Не отправляет почту." if method == "scout_collect"
            else "Запустить один ранее одобренный Scout источник." if method == "scout_start"
            else "Читать разрешённые данные через защищённый посредник."
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
