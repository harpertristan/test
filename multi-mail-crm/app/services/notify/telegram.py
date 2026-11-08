import hashlib
import hmac
import html
from uuid import UUID

from aiogram import Bot, Dispatcher, F
from aiogram.filters import CommandStart, CommandObject
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message as TelegramMessage,
    Update,
)
from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select

from app.core.config import settings
from app.core.db import Session
from app.core.redis import redis
from app.core.security import digest, utcnow
from app.models import Notification, User
from app.services.read_state import request_read

EMOJI = {
    "ad": "📢",
    "add_request": "🟡",
    "approve": "✅",
    "decline": "❌",
    "other": "⚪",
}
LABELS = {
    "ad": "Реклама",
    "add_request": "Доп. запрос",
    "approve": "Одобрение",
    "decline": "Отказ",
    "other": "Другое",
}
dispatcher = Dispatcher()
router = APIRouter(tags=["telegram"])


def webhook_secret():
    return hmac.new(
        settings().jwt_secret.encode(), b"telegram-webhook", hashlib.sha256
    ).hexdigest()


@dispatcher.message(CommandStart())
async def link(message: TelegramMessage, command: CommandObject):
    if message.chat.type != "private" or not message.from_user:
        return
    token = command.args or ""
    async with redis() as client:
        value = await client.getdel("tg-link:" + digest(token))
    if not value:
        await message.answer(
            "Откройте настройки CRM и получите новый одноразовый код привязки (действует 10 минут)."
        )
        return
    async with Session() as session:
        user = await session.get(User, UUID(value), with_for_update=True)
        existing = await session.scalar(
            select(User).where(User.telegram_id == message.from_user.id)
        )
        if not user or not user.is_active or (existing and existing.id != user.id):
            await message.answer(
                "Привязка недоступна. Отвяжите этот Telegram в прежней учётной записи CRM."
            )
            return
        user.telegram_id = message.from_user.id
        user.tg_linked_at = utcnow()
        await session.commit()
    await message.answer(
        "Telegram привязан. Новые письма будут приходить сюда. При потоке писем вы получите сводку."
    )


@dispatcher.callback_query(F.data.startswith("read:"))
async def mark_read(callback: CallbackQuery):
    try:
        identifier = UUID(callback.data.split(":", 1)[1])
    except ValueError:
        await callback.answer("Некорректная кнопка")
        return
    async with Session() as session:
        row = (
            await session.execute(
                select(Notification, User)
                .join(User, User.id == Notification.user_id)
                .where(
                    Notification.id == identifier,
                    User.telegram_id == callback.from_user.id,
                    User.is_active.is_(True),
                )
            )
        ).first()
        if not row:
            await callback.answer("Нет доступа к письму", show_alert=True)
            return
        notice, user = row
        await request_read(session, notice.message_id, True)
        notice.is_seen = True
        await session.commit()
    await callback.answer("Письмо будет отмечено прочитанным в CRM и у провайдера")


def notification_text(account, company, message):
    category = message.category or "other"
    return (
        f"📩 <b>Новое письмо</b>\n\nЯщик: {html.escape(account.email)} ({html.escape(company.name)})\n"
        f"Категория: {EMOJI[category]} {LABELS[category]}\nОт: {html.escape(message.from_email or '')}\n"
        f"Тема: {html.escape((message.subject or 'Без темы')[:500])}\n—"
    )


def keyboard(notice):
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="Открыть в CRM",
                    url=settings().app_url + "/?message=" + str(notice.message_id),
                ),
                InlineKeyboardButton(
                    text="Прочитано", callback_data="read:" + str(notice.id)
                ),
            ]
        ]
    )


@router.post("/webhooks/telegram")
async def webhook(request: Request):
    cfg = settings()
    if not cfg.telegram_bot_token:
        raise HTTPException(503, "Telegram not configured")
    if not hmac.compare_digest(
        request.headers.get("X-Telegram-Bot-Api-Secret-Token", ""), webhook_secret()
    ):
        raise HTTPException(401, "Invalid Telegram webhook token")
    bot = Bot(cfg.telegram_bot_token)
    try:
        update = Update.model_validate(await request.json(), context={"bot": bot})
        await dispatcher.feed_update(bot, update)
    finally:
        await bot.session.close()
    return {"ok": True}
