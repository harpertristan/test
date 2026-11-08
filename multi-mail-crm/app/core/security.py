import hashlib
import json
from datetime import datetime, timezone
from uuid import UUID

from cryptography.fernet import Fernet
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import db
from app.models import User


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def encrypt(value: str) -> bytes:
    return Fernet(settings().fernet_key.encode()).encrypt(value.encode())


def decrypt(value: bytes) -> str:
    return Fernet(settings().fernet_key.encode()).decrypt(value).decode()


def encrypt_tokens(value: dict) -> dict:
    return {"encrypted": encrypt(json.dumps(value)).decode()}


def decrypt_tokens(value: dict | None) -> dict:
    return json.loads(decrypt(value["encrypted"].encode())) if value else {}


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


WORKSPACE_USER_ID = UUID("6cc9981e-7d57-4d37-99c3-d4917ce1a638")


async def workspace_user(session: AsyncSession) -> User:
    """One shared identity for preferences, tasks and Telegram; no login credentials."""
    from sqlalchemy.dialects.postgresql import insert

    user = await session.get(User, WORKSPACE_USER_ID)
    if user is None:
        await session.execute(
            insert(User)
            .values(
                id=WORKSPACE_USER_ID,
                email="workspace@crm.invalid",
                full_name="Общая CRM",
                role="admin",
                password_hash="!login-disabled",
                is_active=True,
                token_version=0,
            )
            .on_conflict_do_nothing()
        )
        user = await session.get(User, WORKSPACE_USER_ID)
    return user


async def current_user(session: AsyncSession = Depends(db)) -> User:
    user = await workspace_user(session)
    await session.commit()
    return user


async def admin(user: User = Depends(current_user)) -> User:
    # This installation deliberately has no authentication or role restrictions.
    return user
