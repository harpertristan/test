import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import Outbox


def event(session: AsyncSession, kind: str, payload: dict, key: str | None = None):
    session.add(
        Outbox(event_key=key or uuid.uuid4().hex, payload={"type": kind, **payload})
    )
