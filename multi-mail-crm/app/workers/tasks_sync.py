import asyncio
from uuid import UUID

import structlog
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert

from app.core.db import Session
from app.core.redis import Busy, Lease, redis
from app.core.security import utcnow
from app.models import MailAccount, Message
from app.services.events import event
from app.services.mail import provider_for
from app.services.pending import account_status
from app.workers.celery_app import celery_app

log = structlog.get_logger()


async def sync_once(account_id, refresh_only=False):
    async with redis() as client:
        await client.delete("queued-sync:" + str(account_id))
        try:
            async with Lease(client, "account:" + str(account_id)) as lease:
                async with Session() as session:
                    account = await session.get(MailAccount, UUID(str(account_id)))
                    if not account or not account.is_active:
                        return
                    provider = provider_for(account, client)
                    try:
                        state = dict(account.sync_state or {})
                        if refresh_only:
                            if hasattr(provider, "access"):
                                await provider.access()
                            state = await provider.renew_push(state)
                            account.sync_state = state
                            lease.ensure()
                            await session.commit()
                            return
                        batch = await provider.fetch(state)
                        provider_id = account.provider_account_id
                        lease.ensure()
                        # Serialize DB counters/categories with readers and processors.
                        await session.refresh(account, with_for_update=True)
                        # refreshed account tokens must not erase the provider's refreshed value
                        if hasattr(provider, "tokens"):
                            from app.core.security import encrypt_tokens

                            account.oauth_token = encrypt_tokens(provider.tokens)
                        if provider_id:
                            account.provider_account_id = provider_id
                        for item in batch.items:
                            message_id = await session.scalar(
                                insert(Message)
                                .values(
                                    mail_account_id=account.id,
                                    company_id=account.company_id,
                                    direction="in",
                                    remote_id=item.remote_id,
                                    message_id=item.message_id,
                                    thread_id=item.thread_id,
                                    from_email=item.from_email,
                                    from_name=item.from_name,
                                    to_emails=item.to_emails,
                                    subject=item.subject,
                                    body_text=item.body_text,
                                    body_html=item.body_html,
                                    received_at=item.received_at,
                                    is_read=item.is_read,
                                    raw_headers=item.headers,
                                    processing_state="pending",
                                )
                                .on_conflict_do_nothing(constraint="uq_message_remote")
                                .returning(Message.id)
                            )
                            if message_id:
                                event(
                                    session,
                                    "process.request",
                                    {"message_id": str(message_id)},
                                    "process:" + str(message_id),
                                )
                        if "__unseen__" in batch.read_flags:
                            unseen = batch.read_flags["__unseen__"]
                            await session.execute(
                                update(Message)
                                .where(
                                    Message.mail_account_id == account.id,
                                    Message.direction == "in",
                                )
                                .values(is_read=Message.remote_id.not_in(unseen))
                            )
                        else:
                            for remote_id, is_read in batch.read_flags.items():
                                await session.execute(
                                    update(Message)
                                    .where(
                                        Message.mail_account_id == account.id,
                                        Message.remote_id == remote_id,
                                    )
                                    .values(is_read=is_read)
                                )
                        account.sync_state = batch.state
                        account.last_uid = batch.state.get("last_uid")
                        account.last_sync_at = utcnow()
                        account.last_error = None
                        await account_status(session, account.id)
                        event(
                            session, "accounts.changed", {"account_id": str(account.id)}
                        )
                        await session.commit()
                        await client.incr("metrics:sync_success")
                        if batch.more:
                            # continuation is broker work, not recursion; recovery scheduler also sees saved cursor
                            sync_account.apply_async(
                                args=[str(account.id)], countdown=3
                            )
                    except Exception as exc:
                        await session.rollback()
                        account = await session.get(
                            MailAccount, UUID(str(account_id)), with_for_update=True
                        )
                        if account:
                            account.last_error = f"{type(exc).__name__}: проверьте авторизацию, доступ провайдера и лимиты"
                            event(
                                session,
                                "accounts.changed",
                                {"account_id": str(account.id)},
                            )
                            await session.commit()
                        await client.incr("metrics:sync_failure")
                        log.warning(
                            "mail.sync.failed",
                            account_id=str(account_id),
                            error_type=type(exc).__name__,
                        )
                        raise
                    finally:
                        await provider.close()
        except Busy:
            return


@celery_app.task(
    name="mail.sync",
    autoretry_for=(Exception,),
    retry_backoff=30,
    retry_backoff_max=600,
    max_retries=3,
)
def sync_account(account_id):
    return asyncio.run(sync_once(account_id))


async def schedule_all():
    async with redis() as client:
        async with Lease(client, "schedule:mail", 60):
            async with Session() as session:
                identifiers = (
                    await session.scalars(
                        select(MailAccount.id).where(MailAccount.is_active.is_(True))
                    )
                ).all()
                for index, identifier in enumerate(identifiers):
                    await enqueue_sync(client, str(identifier), index % 120)


@celery_app.task(name="mail.schedule")
def schedule():
    try:
        return asyncio.run(schedule_all())
    except Busy:
        return


async def refresh_tokens():
    async with Session() as session:
        identifiers = (
            await session.scalars(
                select(MailAccount.id).where(
                    MailAccount.is_active.is_(True),
                    MailAccount.provider.in_(("gmail", "zoho_eu")),
                )
            )
        ).all()
    for index, identifier in enumerate(identifiers):
        refresh_token.apply_async(args=[str(identifier)], countdown=index % 120)


@celery_app.task(name="mail.refresh_tokens")
def refresh_all():
    return asyncio.run(refresh_tokens())


@celery_app.task(
    name="mail.refresh_token",
    autoretry_for=(Exception,),
    retry_backoff=60,
    max_retries=2,
)
def refresh_token(account_id):
    return asyncio.run(sync_once(account_id, True))


async def enqueue_sync(client, account_id, countdown=0):
    if await client.exists("account:" + account_id):
        return False
    key = "queued-sync:" + account_id
    if not await client.set(key, "1", nx=True, ex=600):
        return False
    try:
        sync_account.apply_async(args=[account_id], countdown=countdown)
    except Exception:
        await client.delete(key)
        raise
    return True
