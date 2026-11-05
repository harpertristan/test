import asyncio
from datetime import timedelta
from uuid import UUID

from sqlalchemy import and_, or_, select

from app.core.db import Session
from app.core.redis import Busy, Lease, redis
from app.core.security import utcnow
from app.models import MailAccount, Message
from app.services.events import event
from app.services.mail import provider_for
from app.services.mail_rules import auto_trash_reason, AUTO_TRASH_REASONS
from app.services.trash import request_trash
from app.workers.celery_app import celery_app


async def trash_once(message_id):
    async with redis() as client:
        async with Lease(client, "trash:" + str(message_id)):
            async with Session() as session:
                message = await session.get(Message, UUID(str(message_id)))
                if not message or not message.deleted_at or message.trashed_at:
                    return
                async with Lease(client, "account:" + str(message.mail_account_id)):
                    account = await session.get(
                        MailAccount, message.mail_account_id, with_for_update=True
                    )
                    await session.refresh(message, with_for_update=True)
                    if message.trashed_at or not account:
                        return
                    provider = provider_for(account, client)
                    try:
                        if message.direction != "in" or not message.remote_id:
                            raise ValueError("No remote incoming message")
                        if message.delete_reason in AUTO_TRASH_REASONS:
                            await provider.trash(message.remote_id, mark_read=True)
                            message.is_read = True
                        else:
                            await provider.trash(message.remote_id)
                        message.trashed_at = utcnow()
                        message.trash_error = None
                        message.trash_retry_at = None
                        event(
                            session,
                            "messages.deleted",
                            {
                                "message_id": str(message.id),
                                "account_id": str(account.id),
                            },
                        )
                    except Exception as error:
                        # Provider errors can include credentials; keep only their type.
                        message.trash_error = type(error).__name__
                        message.trash_retry_at = utcnow() + timedelta(minutes=5)
                        event(
                            session,
                            "trash.failed",
                            {
                                "silent": message.delete_reason in AUTO_TRASH_REASONS,
                                "message_id": str(message.id),
                                "account_id": str(account.id),
                            },
                        )
                    finally:
                        if hasattr(provider, "tokens"):
                            from app.core.security import encrypt_tokens

                            account.oauth_token = encrypt_tokens(provider.tokens)
                        await provider.close()
                    await session.commit()


@celery_app.task(
    name="mail.trash", autoretry_for=(Exception,), retry_backoff=10, max_retries=3
)
def trash_message(message_id):
    try:
        return asyncio.run(trash_once(message_id))
    except Busy:
        return  # Recovery scheduler retains the durable intent.


async def cleanup_and_recover():
    async with redis() as client:
        async with Lease(client, "trash:recovery", 60):
            async with Session() as session:
                candidates = (
                    await session.scalars(
                        select(Message)
                        .where(
                            Message.deleted_at.is_(None),
                            Message.direction == "in",
                            or_(
                                and_(
                                    Message.from_email.ilike("support@inbox.eu"),
                                    Message.subject.ilike(
                                        "New sign in from % to your email"
                                    ),
                                ),
                                and_(
                                    Message.from_email.ilike("orders@inbox.eu"),
                                    Message.subject.ilike(
                                        "Thank you! Premium subscription activated!"
                                    ),
                                ),
                            ),
                        )
                        .limit(200)
                    )
                ).all()
                for message in candidates:
                    if reason := auto_trash_reason(message.from_email, message.subject):
                        await request_trash(session, message, reason)
                pending = (
                    await session.scalars(
                        select(Message)
                        .where(
                            Message.deleted_at.is_not(None),
                            Message.trashed_at.is_(None),
                            or_(
                                Message.trash_retry_at.is_(None),
                                Message.trash_retry_at <= utcnow(),
                            ),
                        )
                        .limit(100)
                    )
                ).all()
                for message in pending:
                    message.trash_retry_at = utcnow() + timedelta(minutes=5)
                    event(session, "trash.request", {"message_id": str(message.id)})
                await session.commit()


@celery_app.task(name="mail.cleanup_trash")
def cleanup_trash():
    try:
        return asyncio.run(cleanup_and_recover())
    except Busy:
        return
