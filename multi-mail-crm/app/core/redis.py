import asyncio
import contextlib
import time
import uuid

from redis.asyncio import Redis
from app.core.config import settings


def redis() -> Redis:
    return Redis.from_url(
        settings().redis_url,
        decode_responses=True,
        socket_connect_timeout=5,
        socket_timeout=10,
    )


BUCKET = """
local now = redis.call('TIME')
local t = tonumber(now[1]) + tonumber(now[2])/1000000
local old = redis.call('HMGET', KEYS[1], 'tokens', 'time')
local tokens = tonumber(old[1]) or tonumber(ARGV[2])
local last = tonumber(old[2]) or t
tokens = math.min(tonumber(ARGV[2]), tokens + math.max(0, t-last)*tonumber(ARGV[1]))
local wait = 0
if tokens >= 1 then tokens = tokens-1 else wait = (1-tokens)/tonumber(ARGV[1]) end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'time', t)
redis.call('EXPIRE', KEYS[1], 3600)
return tostring(wait)
"""


async def throttle(client: Redis, key: str, per_minute: int) -> None:
    while True:
        delay = float(
            await client.eval(BUCKET, 1, "limit:" + key, max(1, per_minute) / 60, 1)
        )
        if delay <= 0:
            return
        await asyncio.sleep(delay + 0.01)


class Busy(Exception):
    pass


class Lease:
    def __init__(self, client: Redis, key: str, seconds: int = 180):
        self.client, self.key, self.seconds = client, key, seconds
        self.token = uuid.uuid4().hex
        self.task = None
        self.lost = False

    async def __aenter__(self):
        if not await self.client.set(self.key, self.token, nx=True, ex=self.seconds):
            raise Busy(self.key)
        self.task = asyncio.create_task(self.renew())
        return self

    async def renew(self):
        while True:
            await asyncio.sleep(self.seconds / 3)
            try:
                ok = await self.client.eval(
                    "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('EXPIRE',KEYS[1],ARGV[2]) else return 0 end",
                    1,
                    self.key,
                    self.token,
                    self.seconds,
                )
                if not ok:
                    self.lost = True
                    return
            except Exception:
                self.lost = True
                return

    def ensure(self):
        if self.lost:
            raise Busy("Lease lost")

    async def __aexit__(self, *args):
        self.task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self.task
        await self.client.eval(
            "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",
            1,
            self.key,
            self.token,
        )


class Semaphore:
    """Distributed expiring slots; all worker processes share the same limit."""

    def __init__(self, client: Redis, key: str, limit: int):
        self.client, self.key, self.limit = client, key, limit
        self.token, self.task = uuid.uuid4().hex, None

    async def __aenter__(self):
        for _ in range(60):
            now = time.time()
            ok = await self.client.eval(
                "redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',ARGV[1]); if redis.call('ZCARD',KEYS[1]) < tonumber(ARGV[2]) then redis.call('ZADD',KEYS[1],ARGV[3],ARGV[4]); return 1 else return 0 end",
                1,
                self.key,
                now,
                self.limit,
                now + 180,
                self.token,
            )
            if ok:
                self.task = asyncio.create_task(self.renew())
                return self
            await asyncio.sleep(1)
        raise Busy("IMAP connection pool busy")

    async def renew(self):
        while True:
            await asyncio.sleep(45)
            await self.client.zadd(self.key, {self.token: time.time() + 180}, xx=True)

    async def __aexit__(self, *args):
        self.task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self.task
        await self.client.zrem(self.key, self.token)
