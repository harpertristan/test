from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings

# Celery runs independent asyncio.run loops. NullPool never reuses a connection
# belonging to another loop; PostgreSQL max_connections remains bounded by workers.
engine = create_async_engine(
    settings().database_url, poolclass=NullPool, echo=False, hide_parameters=True
)
Session = async_sessionmaker(engine, expire_on_commit=False)


async def db() -> AsyncIterator[AsyncSession]:
    async with Session() as session:
        yield session
