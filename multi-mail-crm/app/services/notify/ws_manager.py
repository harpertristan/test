import asyncio
import contextlib
import json

import structlog

from app.core.redis import redis

log = structlog.get_logger()


class WSManager:
    def __init__(self):
        self.connections = {}
        self.task = None

    async def start(self):
        self.task = asyncio.create_task(self.listen())

    async def stop(self):
        if self.task:
            self.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.task
        for connections in list(self.connections.values()):
            for socket in list(connections):
                with contextlib.suppress(Exception):
                    await socket.close(code=1001)

    def add(self, user_id, socket):
        self.connections.setdefault(str(user_id), set()).add(socket)

    def remove(self, user_id, socket):
        self.connections.get(str(user_id), set()).discard(socket)
        if not self.connections.get(str(user_id)):
            self.connections.pop(str(user_id), None)

    async def deliver(self, body):
        user_id = body.get("user_id")
        targets = [
            (uid, s)
            for uid, connections in list(self.connections.items())
            for s in list(connections)
            if not user_id or uid == user_id
        ]

        async def send(uid, socket):
            try:
                await asyncio.wait_for(socket.send_json(body), timeout=3)
            except Exception:
                self.remove(uid, socket)

        await asyncio.gather(*(send(uid, socket) for uid, socket in targets))

    async def listen(self):
        while True:
            try:
                # Pub/Sub may be idle indefinitely; cancellation closes the connection.
                async with redis(socket_timeout=None) as client:
                    async with client.pubsub() as channel:
                        await channel.subscribe("crm:events")
                        async for message in channel.listen():
                            if message["type"] == "message":
                                await self.deliver(json.loads(message["data"]))
            except asyncio.CancelledError:
                raise
            except Exception:
                log.warning("websocket.redis.reconnecting")
                await asyncio.sleep(2)


manager = WSManager()
