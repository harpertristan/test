"""Only two local tools. No filesystem, terminal, URL or external send capability."""

import http.client
import json
import socket
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("paperclip_task")


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
            return {"error": "Операция не выполнена. Не утверждай, что статус изменён."}
        return data
    except Exception:
        return {
            "error": "Локальный контроллер недоступен. Не утверждай, что задача завершена."
        }
    finally:
        connection.close()


@mcp.tool()
def current_task(capability: str) -> dict:
    """Проверить привязку текущего запуска. capability берётся только из runtime instructions."""
    return call("/current", {"capability": capability})


@mcp.tool()
def submit_result(capability: str, summary: str) -> dict:
    """Записать краткий результат по-русски и передать текущую задачу на проверку (in_review).
    Не отмечает задачу выполненной и не может менять другую задачу. Проверяй ответ инструмента.
    """
    return call("/submit", {"capability": capability, "summary": summary})


if __name__ == "__main__":
    mcp.run(transport="stdio")
