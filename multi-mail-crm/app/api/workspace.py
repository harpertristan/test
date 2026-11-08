import secrets
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.schemas import UserView
from app.core.config import settings
from app.core.db import db
from app.core.redis import redis
from app.core.security import current_user, digest
from app.models import User

router = APIRouter(tags=["workspace"])


@router.get("/workspace", response_model=UserView)
async def profile(user: User = Depends(current_user)):
    return user


@router.post("/settings/telegram-link")
async def telegram_link(user: User = Depends(current_user)):
    if not settings().telegram_bot_username or not settings().telegram_bot_token:
        raise HTTPException(503, "Сначала настройте Telegram-бота в .env")
    token = secrets.token_urlsafe(24)
    async with redis() as client:
        await client.set("tg-link:" + digest(token), str(user.id), ex=600)
    return {
        "token": token,
        "expires_in": 600,
        "url": f"https://t.me/{settings().telegram_bot_username}?start={token}",
    }


@router.delete("/settings/telegram-link", status_code=204)
async def unlink(
    user: User = Depends(current_user), session: AsyncSession = Depends(db)
):
    user.telegram_id = None
    user.tg_linked_at = None
    session.add(user)
    await session.commit()
