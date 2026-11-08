import asyncio
from app.core.db import Session
from app.services.pending import refresh_needs_reply
from app.services.events import event
from app.workers.celery_app import celery_app


async def refresh():
    async with Session() as session:
        count = await refresh_needs_reply(session)
        event(session, "pending.changed", {})
        await session.commit()
        return count


@celery_app.task(name="mail.pending")
def refresh_pending():
    return asyncio.run(refresh())


async def retention():
    from datetime import timedelta
    from sqlalchemy import delete, select
    from app.core.security import utcnow
    from app.models import Outbox

    async with Session() as session:
        identifiers = (
            await session.scalars(
                select(Outbox.id)
                .where(Outbox.delivered_at < utcnow() - timedelta(days=2))
                .limit(10000)
            )
        ).all()
        if identifiers:
            await session.execute(delete(Outbox).where(Outbox.id.in_(identifiers)))
        await session.commit()


@celery_app.task(name="mail.retention")
def cleanup_outbox():
    return asyncio.run(retention())
