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


async def serve():
    sys.path.insert(0, "/opt/hermes")
    from gateway.config import PlatformConfig
    from gateway.platforms.api_server import APIServerAdapter
    from hermes_cli.config import load_config
    from hermes_cli.tools_config import _get_platform_tools

    # First integration stage is text-only; refuse unexpected tool enablement.
    if _get_platform_tools(load_config(), "api_server"):
        raise RuntimeError("Unexpected enabled toolsets; startup refused")
    key = Path(KEY_FILE).read_text().strip()

    class TextOnlyAPI(APIServerAdapter):
        def _create_agent(self, *args, **kwargs):
            agent = super()._create_agent(*args, **kwargs)
            if getattr(agent, "tools", None):
                raise RuntimeError("Text-only API refused an agent with tools")
            return agent

    adapter = TextOnlyAPI(
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
        "Native Hermes API ready; network disabled; text-only tools configuration",
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
