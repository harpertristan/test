import base64
import os

# Isolated test defaults; production Settings never supplies fallback secrets.
os.environ.setdefault("JWT_SECRET", "test-only-secret-not-for-production-000000000")
os.environ.setdefault("FERNET_KEY", base64.urlsafe_b64encode(b"t" * 32).decode())

os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://unit:unit@localhost:5432/crm_test"
)

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete

from app.core.config import settings
from app.core.db import Session
from app.core.security import workspace_user
from app.models import Base
from app.main import app


@pytest.fixture
async def database():
    if os.environ.get("TEST_INTEGRATION") != "1":
        pytest.skip("Set TEST_INTEGRATION=1 with a dedicated migrated test database")
    if not settings().database_url.rsplit("/", 1)[-1].endswith("_test"):
        pytest.fail("Integration tests require a database name ending in _test")
    async with Session() as session:
        for table in reversed(Base.metadata.sorted_tables):
            await session.execute(delete(table))
        await session.commit()
    yield
    async with Session() as session:
        for table in reversed(Base.metadata.sorted_tables):
            await session.execute(delete(table))
        await session.commit()


@pytest.fixture
async def admin_user(database):
    async with Session() as session:
        user = await workspace_user(session)
        await session.commit()
        return user


@pytest.fixture
async def client(database):
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url=settings().public_url,
        headers={"Origin": settings().public_url},
    ) as client:
        yield client
