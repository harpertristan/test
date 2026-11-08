"""Task-bound local tools. No filesystem, terminal, arbitrary URL or email send capability."""

import http.client
import json
import socket
import sys


class Connection(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect("/run/task-control/control.sock")


def call(path, payload):
    connection = Connection("task-control", timeout=20)
    try:
        connection.request(
            "POST", path, json.dumps(payload), {"Content-Type": "application/json"}
        )
        response = connection.getresponse()
        data = json.loads(response.read(65536))
        if response.status != 200:
            return {
                "error": "Операция не выполнена. Не утверждай, что статус изменён.",
                "code": data.get("code", "TASK_OPERATION_REFUSED"),
            }
        return data
    except Exception:
        return {
            "error": "Локальный контроллер недоступен. Не утверждай, что задача завершена."
        }
    finally:
        connection.close()


class ThreeToolConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect("/run/three-tools/read.sock")


def read_tool(capability: str, operation: str, params: dict) -> dict:
    connection = ThreeToolConnection("three-tools", timeout=12)
    try:
        payload = json.dumps({"capability": capability, "operation": operation, "params": params})
        connection.request("POST", "/read", payload, {"Content-Type": "application/json"})
        response = connection.getresponse()
        data = json.loads(response.read(262144))
        if response.status != 200:
            return {"error": "Чтение отклонено или источник недоступен.", "code": data.get("code", "READ_REFUSED")}
        return data
    except Exception:
        return {"error": "Сервис чтения недоступен. Не выдумывай данные.", "code": "READ_UNAVAILABLE"}
    finally:
        connection.close()


class ScoutStartConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect("/run/three-tools/start.sock")


def scout_start(capability: str) -> dict:
    connection = ScoutStartConnection("scout-start", timeout=15)
    try:
        connection.request("POST", "/start", json.dumps({"capability": capability}),
                           {"Content-Type": "application/json"})
        response = connection.getresponse()
        data = json.loads(response.read(8192))
        if response.status != 200:
            return {"error": "Запуск Scout не подтвержден. Не утверждай, что исследование началось.",
                    "code": data.get("code", "SCOUT_START_REFUSED")}
        return data
    except Exception:
        return {"error": "Шлюз запуска Scout недоступен. Запуск не подтвержден.",
                "code": "SCOUT_START_UNAVAILABLE"}
    finally:
        connection.close()


def current_task(capability: str) -> dict:
    """Проверить привязку текущего запуска. capability берётся только из runtime instructions."""
    return call("/current", {"capability": capability})


def begin_task(capability: str) -> dict:
    """Safely check out the assigned task through native Paperclip ownership rules."""
    return call("/begin", {"capability": capability})


def submit_result(capability: str, summary: str) -> dict:
    """Записать краткий результат по-русски и передать текущую задачу на проверку (in_review).
    Не отмечает задачу выполненной и не может менять другую задачу. Проверяй ответ инструмента.
    """
    return call("/submit", {"capability": capability, "summary": summary})


TOOLS = [
    {
        "name": "current_task",
        "description": "Проверить текущую задачу. capability берётся из доверенных runtime instructions.",
        "inputSchema": {
            "type": "object",
            "properties": {"capability": {"type": "string"}},
            "required": ["capability"],
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": True, "openWorldHint": False},
    },
    {
        "name": "begin_task",
        "description": "Получить назначенную задачу в работу через штатный checkout Paperclip. Только активный подписанный запуск.",
        "inputSchema": {
            "type": "object",
            "properties": {"capability": {"type": "string"}},
            "required": ["capability"],
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "openWorldHint": False},
    },
    {
        "name": "submit_result",
        "description": "Записать результат по-русски и передать текущую задачу на проверку (in_review). Проверяй ответ: ошибка означает, что статус не изменён.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "capability": {"type": "string"},
                "summary": {"type": "string"},
            },
            "required": ["capability", "summary"],
            "additionalProperties": False,
        },
        "annotations": {
            "readOnlyHint": False,
            "destructiveHint": False,
            "openWorldHint": False,
        },
    },
]


TOOLS.append({
    "name": "scout_start",
    "description": "Один разрешённый запуск выбранных веб-источников Scout для активной задачи. Не повторяй запуск при ошибке подтверждения.",
    "inputSchema": {"type": "object", "properties": {"capability": {"type": "string"}},
                    "required": ["capability"], "additionalProperties": False},
    "annotations": {"readOnlyHint": False, "destructiveHint": False, "openWorldHint": False},
})


for _name, _prefix in (("scout_read", "scout_"), ("assistant_read", "assistant_"), ("mail_crm_read", "mail_")):
    TOOLS.append({
        "name": _name,
        "description": "Разрешённые операции чтения; служебное разрешение подставляется автоматически.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "capability": {"type": "string"},
                "operation": {"type": "string", "pattern": "^" + _prefix + "[a-z_]+$"},
                "params": {"type": "object", "additionalProperties": {"type": "string"}},
            },
            "required": ["capability", "operation", "params"],
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": True, "openWorldHint": False},
    })


def dispatch(method, params):
    if method == "initialize":
        supported = {"2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"}
        version = params.get("protocolVersion")
        return {
            "protocolVersion": version if version in supported else "2025-11-25",
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": "paperclip_task", "version": "1.0.0"},
        }
    if method == "ping":
        return {}
    if method == "tools/list":
        return {"tools": TOOLS}
    if method == "tools/call":
        name, arguments = params.get("name"), params.get("arguments", {})
        if not isinstance(arguments, dict):
            raise ValueError("Invalid arguments")
        if name not in {"current_task", "begin_task", "submit_result", "scout_start", "scout_read", "assistant_read", "mail_crm_read"}:
            raise ValueError("Unknown tool")
        expected = (
            {"capability"} if name in ("current_task", "begin_task", "scout_start")
            else {"capability", "summary"} if name == "submit_result"
            else {"capability", "operation", "params"}
        )
        if set(arguments) != expected:
            raise ValueError("Invalid arguments")
        capability = arguments.get("capability")
        if not isinstance(capability, str) or not 1 <= len(capability) <= 160:
            raise ValueError("Invalid capability")
        if name == "submit_result":
            summary = arguments.get("summary")
            if not isinstance(summary, str) or not summary.strip() or len(summary) > 8000:
                raise ValueError("Invalid summary")
        if name in ("scout_read", "assistant_read", "mail_crm_read"):
            operation = arguments.get("operation")
            prefix = {"scout_read": "scout_", "assistant_read": "assistant_", "mail_crm_read": "mail_"}[name]
            if not isinstance(operation, str) or not operation.startswith(prefix):
                raise ValueError("Operation prefix mismatch")
            tool_params = arguments.get("params")
            if not isinstance(tool_params, dict) or len(tool_params) > 2:
                raise ValueError("Invalid params")
            result = read_tool(capability, operation, tool_params)
        elif name == "current_task":
            result = current_task(**arguments)
        elif name == "begin_task":
            result = begin_task(**arguments)
        elif name == "scout_start":
            result = scout_start(**arguments)
        else:
            result = submit_result(**arguments)
        return {
            "content": [
                {"type": "text", "text": json.dumps(result, ensure_ascii=False)}
            ],
            "isError": "error" in result,
        }
    raise LookupError("Method not found")


def main():
    # MCP stdio uses one UTF-8 JSON-RPC message per line. No third-party server SDK.
    while raw := sys.stdin.buffer.readline(65537):
        request_id = None
        try:
            if len(raw) > 65536:
                break
            request = json.loads(raw)
            if not isinstance(request, dict) or request.get("jsonrpc") != "2.0":
                raise ValueError("Invalid JSON-RPC")
            if "id" not in request:  # notifications never receive a response
                continue
            request_id = request["id"]
            params = request.get("params", {})
            if not isinstance(params, dict):
                raise ValueError("Invalid parameters")
            response = {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": dispatch(request.get("method"), params),
            }
        except LookupError:
            response = {
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": -32601, "message": "Method not found"},
            }
        except Exception:
            response = {
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": -32602, "message": "Invalid request"},
            }
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
