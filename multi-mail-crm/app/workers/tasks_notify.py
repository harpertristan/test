import asyncio
import json
import time
from uuid import UUID

from aiogram import Bot
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
from sqlalchemy import select

from app.core.config import settings
from app.core.db import Session
from app.core.redis import Busy, Lease, redis
from app.core.security import utcnow
from app.models import Company, MailAccount, Message, Notification, Outbox, User
from app.services.notify.telegram import keyboard, notification_text
from app.workers.celery_app import celery_app


async def dispatch_outbox():
    async with redis() as client:
        async with Lease(client, "outbox:dispatcher", 60):
            async with Session() as session:
                rows = (
                    await session.scalars(
                        select(Outbox)
                        .where(Outbox.delivered_at.is_(None))
                        .order_by(Outbox.created_at)
                        .limit(100)
                        .with_for_update(skip_locked=True)
                    )
                ).all()
                for row in rows:
                    payload = row.payload
                    kind = payload["type"]
                    if kind == "sync.request":
                        from app.workers.tasks_sync import enqueue_sync

                        await enqueue_sync(client, payload["account_id"])
                    elif kind == "process.request":
                        from app.workers.tasks_process import process_new_message

                        process_new_message.delay(payload["message_id"])
                    elif kind == "read.request":
                        from app.workers.tasks_process import mark_read

                        mark_read.delay(
                            payload["message_id"],
                            payload["value"],
                            payload.get("version"),
                        )
                    elif kind == "send.request":
                        from app.workers.tasks_process import send_reply

                        send_reply.delay(payload["message_id"])
                    else:
                        await client.publish(
                            "crm:events",
                            json.dumps({"event_id": str(row.id), **payload}),
                        )
                        if kind == "notification" and settings().telegram_bot_token:
                            user = await session.get(User, UUID(payload["user_id"]))
                            if user and user.is_active and user.telegram_id:
                                await client.zadd(
                                    "tg:buffer:" + str(user.id),
                                    {payload["notification_id"]: time.time()},
                                    nx=True,
                                )
                                await client.zadd(
                                    "tg:due", {str(user.id): time.time() + 60}, nx=True
                                )
                    row.delivered_at = utcnow()
                await session.commit()


@celery_app.task(
    name="notify.outbox", autoretry_for=(Exception,), retry_backoff=5, max_retries=3
)
def flush_outbox():
    try:
        return asyncio.run(dispatch_outbox())
    except Busy:
        return


async def flush_telegram():
    if not settings().telegram_bot_token:
        return
    bot = Bot(settings().telegram_bot_token)
    try:
        async with redis() as client:
            # Read only due users. Redis buffers remain until successful DB acknowledgement.
            users = await client.zrangebyscore(
                "tg:due", "-inf", time.time(), start=0, num=30
            )
            for user_id in users:
                try:
                    async with Lease(client, "tg:lock:" + user_id):
                        identifiers = await client.zrange("tg:buffer:" + user_id, 0, -1)
                        if not identifiers:
                            await client.zrem("tg:due", user_id)
                            continue
                        async with Session() as session:
                            user = await session.get(User, UUID(user_id))
                            if not user or not user.is_active or not user.telegram_id:
                                await client.zrem("tg:buffer:" + user_id, *identifiers)
                                await client.zrem("tg:due", user_id)
                                continue
                            rows = (
                                await session.execute(
                                    select(Notification, Message, MailAccount, Company)
                                    .join(
                                        Message, Message.id == Notification.message_id
                                    )
                                    .join(
                                        MailAccount,
                                        MailAccount.id == Notification.mail_account_id,
                                    )
                                    .join(Company, Company.id == MailAccount.company_id)
                                    .where(
                                        Notification.id.in_(
                                            [UUID(i) for i in identifiers]
                                        ),
                                        Notification.user_id == user.id,
                                        Notification.telegram_sent_at.is_(None),
                                    )
                                    .order_by(Notification.created_at)
                                )
                            ).all()
                            if len(rows) > 5:
                                from collections import Counter
                                import html

                                counts = Counter(
                                    account.email for _, _, account, _ in rows
                                )
                                lines = "\n".join(
                                    html.escape(address) + ": " + str(count)
                                    for address, count in list(counts.items())[:15]
                                )
                                text = f"📩 <b>Новых писем: {len(rows)}</b>\nСводка за окно уведомлений:\n{lines}"
                                await bot.send_message(
                                    user.telegram_id,
                                    text,
                                    parse_mode="HTML",
                                    reply_markup=InlineKeyboardMarkup(
                                        inline_keyboard=[
                                            [
                                                InlineKeyboardButton(
                                                    text="Открыть CRM",
                                                    url=settings().app_url,
                                                )
                                            ]
                                        ]
                                    ),
                                )
                                for notice, _, _, _ in rows:
                                    notice.telegram_sent_at = utcnow()
                                await session.commit()
                            else:
                                for notice, message, account, company in rows:
                                    await bot.send_message(
                                        user.telegram_id,
                                        notification_text(account, company, message),
                                        parse_mode="HTML",
                                        reply_markup=keyboard(notice),
                                    )
                                    notice.telegram_sent_at = utcnow()
                                    await session.commit()
                            # Delete only the snapshot; messages arriving during delivery stay queued.
                            await client.zrem("tg:buffer:" + user_id, *identifiers)
                            if await client.zcard("tg:buffer:" + user_id):
                                await client.zadd("tg:due", {user_id: time.time() + 60})
                            else:
                                await client.zrem("tg:due", user_id)
                            await client.incr("metrics:telegram_batches")
                except Busy:
                    continue
                except Exception:
                    await client.zadd("tg:due", {user_id: time.time() + 60})
                    await client.incr("metrics:telegram_failures")
    finally:
        await bot.session.close()


@celery_app.task(name="notify.telegram")
def send_telegram():
    return asyncio.run(flush_telegram())
