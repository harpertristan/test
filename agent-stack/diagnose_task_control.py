"""Inspect MCP compatibility in a disposable isolated container, with synthetic config."""

import sys

from bootstrap_owner import BASE, HERE, run
from prepare_task_control import CONFIG

PROGRAM = r"""
import importlib.metadata
import json
import logging
import os
from pathlib import Path
import sys
import tempfile
import traceback

home = tempfile.mkdtemp(prefix="task-control-check-")
os.environ["HOME"] = home
os.environ["HERMES_HOME"] = home
Path(home, "config.yaml").write_text(sys.stdin.read())
sys.path.insert(0, "/opt/hermes")
logging.disable(logging.CRITICAL)

try:
    import mcp
    print("SDK mcp:", importlib.metadata.version("mcp"), flush=True)
    from hermes_cli.config import load_config
    from hermes_cli.tools_config import _get_platform_tools
    selected = _get_platform_tools(load_config(), "api_server")
    print("Configured toolsets:", json.dumps(sorted(selected)), flush=True)
    from tools.mcp_tool_discovery import discover_mcp_tools
    discovered = discover_mcp_tools(["paperclip_task"])
    print("Discovered tools:", json.dumps(sorted(discovered)), flush=True)
    from tools.registry import registry
    from tools.mcp_tool_schema import mcp_prefixed_tool_name
    from task_runtime_context import TaskBindings, install_task_handlers
    install_task_handlers(registry, TaskBindings(), mcp_prefixed_tool_name)
    from model_tools import get_tool_definitions
    definitions = get_tool_definitions(enabled_toolsets=["paperclip_task"], quiet_mode=True)
    exposed = sorted(tool.get("function", {}).get("name", "") for tool in definitions)
    print("Model tool surface:", json.dumps(exposed), flush=True)
    from tools.mcp_tool_schema import mcp_prefixed_tool_name
    expected = {mcp_prefixed_tool_name("paperclip_task", name)
                for name in ("current_task", "submit_result")}
    hidden = all("capability" not in tool.get("function",{}).get("parameters",{}).get("properties",{}) for tool in definitions)
    print("Model does not handle grants:", "PASS" if hidden else "FAIL", flush=True)
    print("Exact two-tool contract:", "PASS" if set(discovered) == expected and set(exposed) == expected and hidden else "FAIL", flush=True)
except Exception as error:
    print("Diagnostic error type:", type(error).__name__, flush=True)
    name = getattr(error, "name", None)
    if isinstance(name, str) and all(c.isalnum() or c in "_." for c in name):
        print("Missing module:", name, flush=True)
    for frame in traceback.extract_tb(error.__traceback__)[-6:]:
        print("Frame:", Path(frame.filename).name, "line", frame.lineno, flush=True)
finally:
    print("No tasks or model calls were performed.", flush=True)
    sys.stdout.flush()
    os._exit(0)
"""


def main():
    command = BASE + [
        "-f",
        str(HERE / "compose.hermes-gateway.yaml"),
        "-f",
        str(HERE / "compose.task-control.yaml"),
        "run",
        "--rm",
        "--no-deps",
        "-T",
        "--entrypoint",
        "/opt/hermes/.venv/bin/python",
        "hermes-runtime",
        "-c",
        PROGRAM,
    ]
    print("Проверяю MCP во временном контейнере с отключённой сетью…", flush=True)
    output = run(command, input=CONFIG)
    print(output, end="")
    if "--install-if-compatible" in sys.argv:
        if "Exact two-tool contract: PASS" not in output.splitlines():
            raise RuntimeError(
                "Совместимость ещё не подтверждена; настройки Hermes не менялись"
            )
        from install_task_control import main as install

        install()


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError) as error:
        raise SystemExit(str(error)) from None
