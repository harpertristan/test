import asyncio
import os
import time
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    generate_latest,
    CollectorRegistry,
    multiprocess,
)
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.api import accounts, workspace, companies, messages, oauth, webhooks, ws
from app.core.config import settings
from app.core.db import Session, engine
from app.core.observability import HTTP_LATENCY, HTTP_REQUESTS, configure_logging
from app.core.redis import redis
from app.core.schema import expected_schema_revision
from app.core.security import workspace_user
from app.services.notify import telegram
from app.services.notify.ws_manager import manager

configure_logging()
log = structlog.get_logger()


@asynccontextmanager
async def lifespan(app):
    async with Session() as session:
        await workspace_user(session)
        await session.commit()
    await manager.start()
    yield
    await manager.stop()
    await engine.dispose()


app = FastAPI(title="Мультипочтовая CRM", version="1.0.0", lifespan=lifespan)
for router in (
    workspace.router,
    companies.router,
    accounts.router,
    messages.router,
    oauth.router,
    webhooks.router,
    ws.router,
    telegram.router,
):
    app.include_router(router)


@app.middleware("http")
async def guard(request: Request, call_next):
    started = time.monotonic()
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        # Reject cross-origin browser writes even though this installation has no login.
        if origin and origin != settings().public_url:
            return JSONResponse({"detail": "Недопустимый Origin"}, status_code=403)
        size = request.headers.get("content-length")
        if size and (not size.isdigit() or int(size) > 2 * 1024 * 1024):
            return JSONResponse({"detail": "Запрос слишком большой"}, status_code=413)
    try:
        response = await call_next(request)
    except Exception as exc:
        log.error("http.failed", error_type=type(exc).__name__, path=request.url.path)
        response = JSONResponse(
            {"detail": "Внутренняя ошибка; проверьте журнал сервера"}, status_code=500
        )
    route = request.scope.get("route")
    path = route.path if route else "unmatched"
    HTTP_REQUESTS.labels(request.method, path, response.status_code).inc()
    HTTP_LATENCY.labels(request.method, path).observe(time.monotonic() - started)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(IntegrityError)
async def integrity(request, exc):
    return JSONResponse(
        {
            "detail": "Конфликт данных: запись уже существует или связана с другими записями"
        },
        status_code=409,
    )


@app.get("/health/live", tags=["health"])
async def live():
    return {"status": "alive", "version": "1.0.0"}


@app.get("/health/ready", tags=["health"])
async def ready():
    try:
        async with asyncio.timeout(5):
            async with Session() as session:
                await session.execute(text("SELECT 1"))
                revision = await session.scalar(
                    text("SELECT version_num FROM alembic_version")
                )
                if revision != expected_schema_revision():
                    raise ValueError("Schema mismatch")
            async with redis() as client:
                await client.ping()
    except Exception:
        return JSONResponse({"status": "unavailable"}, status_code=503)
    return {"status": "ready", "postgres": True, "redis": True, "schema": revision}


@app.get("/metrics", tags=["monitoring"])
async def metrics():
    # Internal endpoint. Nginx blocks this path from the published frontend.
    registry = (
        CollectorRegistry() if os.environ.get("PROMETHEUS_MULTIPROC_DIR") else None
    )
    if registry is not None:
        multiprocess.MultiProcessCollector(registry)
    body = (
        generate_latest(registry) if registry is not None else generate_latest()
    ).decode()
    try:
        async with redis() as client:
            for name in (
                "sync_success",
                "sync_failure",
                "classified",
                "classification_fallback",
                "telegram_batches",
                "telegram_failures",
            ):
                count = await client.get("metrics:" + name) or "0"
                body += (
                    f"# TYPE crm_{name}_total counter\ncrm_{name}_total {int(count)}\n"
                )
    except Exception:
        pass
    return Response(body, media_type=CONTENT_TYPE_LATEST)
