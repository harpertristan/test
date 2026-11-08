"""Minimal native Hermes API, no gateway scheduler or messaging platforms."""

import asyncio
import os
from pathlib import Path
import signal
import sys
import threading
import http.server

from hermes_gateway_bridge import KEY_FILE, native_bridge
from launch_hermes import LocalHandler
from task_runtime_context import TaskBindings, extract_grant, install_task_handlers


async def serve():
    sys.path.insert(0, "/opt/hermes")
    from gateway.config import PlatformConfig
    from gateway.platforms.api_server import APIServerAdapter
    from hermes_cli.config import load_config
    from hermes_cli.tools_config import _get_platform_tools

    from tools.mcp_tool_schema import mcp_prefixed_tool_name

    allowed_task_tools = {
        mcp_prefixed_tool_name("paperclip_task", name)
        for name in ("current_task", "begin_task", "submit_result", "request_approval",
                     "web_research", "skills_memory", "developer_status", "scout_start", "scout_collect", "scout_read", "assistant_read", "mail_crm_read", "scout_crm_manage", "operator_capabilities", "developer_workspace")
    }

    # Only the explicitly scoped task server may add tools.
    selected = _get_platform_tools(load_config(), "api_server")
    if selected - {"paperclip_task"}:
        raise RuntimeError("Unexpected enabled toolsets; startup refused")
    bindings = TaskBindings()
    if "paperclip_task" in selected:
        from tools.mcp_tool_discovery import discover_mcp_tools

        tools = await asyncio.to_thread(discover_mcp_tools, ["paperclip_task"])
        if set(tools) != allowed_task_tools:
            raise RuntimeError("Scoped task tools not available; startup refused")
        from tools.registry import registry

        install_task_handlers(registry, bindings, mcp_prefixed_tool_name)
    key = Path(KEY_FILE).read_text().strip()

    class ScopedAPI(APIServerAdapter):
        def _create_agent(self, *args, **kwargs):
            capability = None
            if "paperclip_task" in selected:
                install_task_handlers(registry, bindings, mcp_prefixed_tool_name)
                if args:
                    raise RuntimeError("Unexpected native agent invocation")
                cleaned, capability = extract_grant(
                    kwargs.get("ephemeral_system_prompt")
                )
                kwargs["ephemeral_system_prompt"] = cleaned
            agent = super()._create_agent(*args, **kwargs)
            exposed = {
                tool.get("function", {}).get("name")
                for tool in (getattr(agent, "tools", []) or [])
            }
            expected = allowed_task_tools if "paperclip_task" in selected else set()
            if exposed != expected:
                raise RuntimeError("Unexpected tool surface; run refused")
            if capability:
                original = agent.run_conversation

                def run_with_context(*run_args, **run_kwargs):
                    with bindings.bind(agent.session_id, capability):
                        return original(*run_args, **run_kwargs)

                agent.run_conversation = run_with_context
            return agent

    adapter = ScopedAPI(
        PlatformConfig(
            enabled=True,
            extra={
                "host": "127.0.0.1",
                "port": 8643,
                "key": key,
            },
        )
    )
    if not await adapter.connect():
        raise RuntimeError("Native Hermes API failed to start")
    ingress = native_bridge()
    threading.Thread(target=ingress.serve_forever, daemon=True).start()
    stopped = asyncio.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        asyncio.get_running_loop().add_signal_handler(sig, stopped.set)
    print(
        "Native Hermes API ready; network disabled; restricted task tools configuration",
        flush=True,
    )
    try:
        await stopped.wait()
    finally:
        await adapter.disconnect()
        ingress.shutdown()
        ingress.server_close()


def main():
    os.chdir("/opt/data")
    model = http.server.ThreadingHTTPServer(("127.0.0.1", 18080), LocalHandler)
    model.daemon_threads = True
    threading.Thread(target=model.serve_forever, daemon=True).start()
    try:
        asyncio.run(serve())
    finally:
        model.shutdown()
        model.server_close()


if __name__ == "__main__":
    main()
