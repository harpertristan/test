"""Explicitly invoked local E2E fixture. Creates no real mail connections.

Run only in a disposable development deployment. stdout contains only fixture IDs; no login or password is created.
"""

import asyncio
import json
import os
import secrets
import sys
from datetime import timedelta
from uuid import UUID, uuid4

from sqlalchemy import delete

from app.core.db import Session
from app.core.security import encrypt, utcnow, workspace_user
from app.models import Company, MailAccount, Message, User


async def seed():
    marker = uuid4().hex
    async with Session() as session:
        user = await workspace_user(session)
        company = Company(name="Проверка " + marker)
        session.add(company)
        await session.flush()
        account = MailAccount(
            company_id=company.id,
            provider="inbox_eu",
            email="mail-" + marker + "@example.com",
            imap_pass_enc=encrypt(secrets.token_urlsafe(24)),
            is_active=False,
        )
        session.add(account)
        await session.flush()
        message = Message(
            mail_account_id=account.id,
            company_id=company.id,
            direction="in",
            remote_id="smoke",
            message_id="<" + marker + "@example.com>",
            thread_id="smoke-" + marker,
            from_email="client@example.com",
            to_emails=[account.email],
            subject="Проверка полного пайплайна",
            body_text="Тест без внешнего почтового сервера. Нужен ответ.",
            received_at=utcnow() - timedelta(days=3),
            is_read=False,
            processing_state="held",
        )
        session.add(message)
        await session.commit()
        print(
            json.dumps(
                {
                    "user_id": str(user.id),
                    "company_id": str(company.id),
                    "account_id": str(account.id),
                    "message_id": str(message.id),
                }
            )
        )


async def cleanup(data):
    async with Session() as session:
        # Scope every deletion to IDs produced by seed; preserve all other records.
        user = await session.get(User, UUID(data["user_id"]))
        company = await session.get(Company, UUID(data["company_id"]))
        if (
            not user
            or user.id != UUID("6cc9981e-7d57-4d37-99c3-d4917ce1a638")
            or not company
            or not company.name.startswith("Проверка ")
        ):
            raise ValueError("Fixture identity mismatch")
        await session.execute(
            delete(MailAccount).where(
                MailAccount.id == UUID(data["account_id"]),
                MailAccount.company_id == company.id,
            )
        )
        await session.delete(company)
        await session.flush()
        await session.commit()


if __name__ == "__main__":
    if os.environ.get("CRM_ALLOW_SMOKE_SEED") != "1":
        raise SystemExit(
            "Only for disposable local E2E deployments; set CRM_ALLOW_SMOKE_SEED=1"
        )
    if sys.argv[1:] == ["seed"]:
        asyncio.run(seed())
    elif sys.argv[1:] == ["cleanup"]:
        asyncio.run(cleanup(json.load(sys.stdin)))
    else:
        raise SystemExit("Use seed or cleanup")
