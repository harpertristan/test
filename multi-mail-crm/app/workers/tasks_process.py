import asyncio
from uuid import UUID

from sqlalchemy import select, update

from app.core.db import Session
from app.core.redis import Busy, Lease, redis
from app.core.security import utcnow, workspace_user
from app.models import MailAccount, Message, Notification
from app.services.classifier import classifier_for
from app.services.events import event
from app.services.mail import provider_for
from app.services.pending import account_status, mark_replied, REPLY_CATEGORIES
from app.workers.celery_app import celery_app


async def process(message_id):
    async with redis() as client:
        async with Lease(client, "process:" + str(message_id)):
            async with Session() as session:
                message = await session.get(Message, UUID(str(message_id)))
                if (
                    not message
                    or message.deleted_at is not None
                    or message.direction != "in"
                    or message.processing_state == "done"
                ):
                    return
                from app.services.mail_rules import auto_trash_reason

                if reason := auto_trash_reason(message.from_email, message.subject):
                    from app.services.trash import request_trash

                    await request_trash(session, message, reason)
                    await session.commit()
                    return
                result = await classifier_for(client).classify(
                    message.subject or "", message.body_text or ""
                )
                account = await session.get(
                    MailAccount, message.mail_account_id, with_for_update=True
                )
                await session.refresh(message, with_for_update=True)
                if message.deleted_at or message.processing_state == "done":
                    return
                message.category = result.category
                message.category_conf = result.confidence
                message.category_reason = result.reason
                message.classified_at = utcnow()
                message.needs_reply = (
                    result.category in REPLY_CATEGORIES and message.replied_at is None
                )
                message.processing_state = "done"
                await session.flush()
                await account_status(session, account.id)
                users = [await workspace_user(session)]
                for user in users:
                    notice = Notification(
                        user_id=user.id,
                        message_id=message.id,
                        mail_account_id=account.id,
                    )
                    session.add(notice)
                    await session.flush()
                    event(
                        session,
                        "notification",
                        {
                            "user_id": str(user.id),
                            "notification_id": str(notice.id),
                            "message_id": str(message.id),
                            "account_id": str(account.id),
                            "company_id": str(message.company_id),
                            "email": account.email,
                            "subject": message.subject,
                            "category": message.category,
                        },
                        "notice:" + str(notice.id),
                    )
                event(
                    session,
                    "messages.changed",
                    {"account_id": str(account.id), "message_id": str(message.id)},
                )
                await session.commit()
                await client.incr("metrics:classified")
                if result.confidence == 0:
                    await client.incr("metrics:classification_fallback")


@celery_app.task(
    name="mail.process", autoretry_for=(Exception,), retry_backoff=15, max_retries=3
)
def process_new_message(message_id):
    try:
        return asyncio.run(process(message_id))
    except Busy:
        return


async def set_read(message_id, value, version=None):
    async with redis() as client:
        async with Session() as session:
            message = await session.get(Message, UUID(str(message_id)))
            if not message:
                return
            async with Lease(client, "account:" + str(message.mail_account_id)):
                account = await session.get(
                    MailAccount, message.mail_account_id, with_for_update=True
                )
                if not account:
                    return
                await session.refresh(message, with_for_update=True)
                if message.deleted_at:
                    return
                if version is not None and version != message.read_revision:
                    return
                if message.desired_read is not None:
                    value = message.desired_read
                provider = provider_for(account, client)
                try:
                    await provider.mark_read(message.remote_id, value)
                    message.is_read = value
                    message.desired_read = None
                    await session.flush()
                    await account_status(session, account.id)
                    event(
                        session,
                        "messages.changed",
                        {"account_id": str(account.id), "message_id": str(message.id)},
                    )
                    await session.commit()
                finally:
                    await provider.close()


@celery_app.task(
    name="mail.read", autoretry_for=(Exception,), retry_backoff=5, max_retries=5
)
def mark_read(message_id, value, version=None):
    return asyncio.run(set_read(message_id, value, version))


async def send(message_id):
    async with redis() as client:
        async with Lease(client, "send:" + str(message_id)):
            async with Session() as session:
                message = await session.get(Message, UUID(str(message_id)))
                if not message or message.send_state != "queued":
                    return
                async with Lease(client, "account:" + str(message.mail_account_id)):
                    account = await session.get(
                        MailAccount, message.mail_account_id, with_for_update=True
                    )
                    original = await session.get(Message, message.reply_to_id)
                    if (
                        not account
                        or not account.is_active
                        or not original
                        or original.deleted_at
                    ):
                        message.send_state = "failed"
                        message.send_error = "Ящик выключен или исходное письмо удалено"
                        await session.commit()
                        return
                    message.send_state = "sending"
                    await session.commit()
                    provider = provider_for(account, client)
                    started = utcnow()
                    try:
                        remote_id = await provider.send(message, original)
                        await session.get(MailAccount, account.id, with_for_update=True)
                        message.remote_id = remote_id
                        message.send_state = "sent"
                        message.send_error = None
                        message.received_at = started
                        await mark_replied(session, message=original, before=started)
                        event(
                            session,
                            "messages.changed",
                            {
                                "account_id": str(account.id),
                                "message_id": str(message.id),
                            },
                        )
                        await session.commit()
                    except Exception as exc:
                        await session.rollback()
                        message = await session.get(
                            Message, UUID(str(message_id)), with_for_update=True
                        )
                        message.send_state = "uncertain"
                        message.send_error = f"{type(exc).__name__}: проверьте папку «Отправленные» перед повторной отправкой"
                        event(
                            session,
                            "messages.changed",
                            {
                                "account_id": str(message.mail_account_id),
                                "message_id": str(message.id),
                            },
                        )
                        await session.commit()
                    finally:
                        await provider.close()


@celery_app.task(
    name="mail.send", autoretry_for=(Busy,), retry_backoff=10, max_retries=6
)
def send_reply(message_id):
    return asyncio.run(send(message_id))


async def recover():
    async with Session() as session:
        identifiers = (
            await session.scalars(
                select(Message.id)
                .where(
                    Message.direction == "in",
                    Message.deleted_at.is_(None),
                    Message.processing_state == "pending",
                )
                .limit(200)
            )
        ).all()
        for identifier in identifiers:
            process_new_message.delay(str(identifier))
        queued = (
            await session.scalars(
                select(Message.id)
                .where(Message.direction == "out", Message.send_state == "queued")
                .limit(100)
            )
        ).all()
        for identifier in queued:
            send_reply.delay(str(identifier))
        reads = (
            await session.execute(
                select(Message.id, Message.desired_read, Message.read_revision)
                .where(Message.desired_read.is_not(None), Message.deleted_at.is_(None))
                .limit(100)
            )
        ).all()
        for identifier, value, version in reads:
            mark_read.delay(str(identifier), value, version)
        # A crashed worker after SMTP acceptance must not cause an automatic duplicate.
        from datetime import timedelta

        await session.execute(
            update(Message)
            .where(
                Message.send_state == "sending",
                Message.received_at < utcnow() - timedelta(minutes=30),
            )
            .values(
                send_state="uncertain",
                send_error="Процесс отправки прерван; проверьте папку «Отправленные»",
            )
        )
        await session.commit()


@celery_app.task(name="mail.recover")
def recover_pending():
    return asyncio.run(recover())
