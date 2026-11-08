from datetime import timedelta
from uuid import UUID

from sqlalchemy import case, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import utcnow
from app.models import MailAccount, Message

PRIORITY = ["add_request", "decline", "approve", "other", "ad"]
REPLY_CATEGORIES = ("add_request", "other")


def overdue(message: Message, now=None) -> bool:
    return bool(
        not getattr(message, "deleted_at", None)
        and message.direction == "in"
        and message.category in REPLY_CATEGORIES
        and message.replied_at is None
        and message.needs_reply
        and (now or utcnow()) - message.received_at > timedelta(days=2)
    )


async def account_status(session: AsyncSession, account_id: UUID) -> None:
    # All mutators lock the same account row before changing message flags/categories.
    rank = case(
        {c: i for i, c in enumerate(PRIORITY)}, value=Message.category, else_=99
    )
    conditions = (
        Message.mail_account_id == account_id,
        Message.deleted_at.is_(None),
        Message.direction == "in",
        Message.is_read.is_(False),
    )
    count, latest = (
        await session.execute(
            select(func.count(), func.max(Message.received_at)).where(*conditions)
        )
    ).one()
    category = await session.scalar(
        select(Message.category)
        .where(*conditions)
        .order_by(rank, Message.received_at.desc())
        .limit(1)
    )
    await session.execute(
        update(MailAccount)
        .where(MailAccount.id == account_id)
        .values(unread_count=count, current_status=category, last_unread_at=latest)
    )


async def refresh_needs_reply(session: AsyncSession) -> int:
    # needs_reply describes an unanswered message, age is separately used for the dot.
    wanted = (
        (Message.direction == "in")
        & Message.deleted_at.is_(None)
        & Message.category.in_(REPLY_CATEGORIES)
        & Message.replied_at.is_(None)
    )
    result = await session.execute(
        update(Message).where(Message.needs_reply != wanted).values(needs_reply=wanted)
    )
    return result.rowcount


async def mark_replied(
    session: AsyncSession,
    *,
    message: Message | None = None,
    company_id: UUID | None = None,
    before=None,
) -> None:
    limit = before or utcnow()
    query = update(Message).where(
        Message.direction == "in",
        Message.deleted_at.is_(None),
        Message.received_at <= limit,
        Message.replied_at.is_(None),
    )
    if message:
        # Mark the whole conversation up to this reply; never clear a later incoming.
        query = (
            query.where(
                Message.mail_account_id == message.mail_account_id,
                Message.thread_id == message.thread_id,
            )
            if message.thread_id
            else query.where(Message.id == message.id)
        )
    else:
        query = query.where(Message.company_id == company_id)
    await session.execute(query.values(replied_at=limit, needs_reply=False))
