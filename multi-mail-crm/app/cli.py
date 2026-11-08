import argparse
import asyncio
import csv
import os
import re
import sys

from sqlalchemy import select

from app.core.config import settings
from app.core.db import Session


async def telegram_setup():
    from aiogram import Bot
    from app.services.notify.telegram import webhook_secret

    cfg = settings()
    if not cfg.public_url.startswith("https://"):
        raise ValueError("Для Telegram webhook нужен PUBLIC_URL с HTTPS")
    if not cfg.telegram_bot_token:
        raise ValueError("Укажите TELEGRAM_BOT_TOKEN в .env")
    bot = Bot(cfg.telegram_bot_token)
    try:
        await bot.set_webhook(
            cfg.app_url + "/api/webhooks/telegram",
            secret_token=webhook_secret(),
            allowed_updates=["message", "callback_query"],
            drop_pending_updates=False,
        )
        info = await bot.get_me()
        print("Webhook установлен. Имя бота:", info.username)
    finally:
        await bot.session.close()


async def import_accounts(path):
    from dotenv import load_dotenv
    from pydantic import ValidationError
    from app.api.schemas import AccountInput
    from app.core.security import encrypt
    from app.models import Company, MailAccount

    load_dotenv(override=False)
    handle = sys.stdin if path == "-" else open(path, encoding="utf-8-sig", newline="")
    count = 0
    skipped = 0
    try:
        async with Session() as session:
            for line, row in enumerate(csv.DictReader(handle), 2):
                if not row.get("company"):
                    raise ValueError(f"Строка {line}: нет компании")
                company = await session.scalar(
                    select(Company).where(Company.name == row["company"])
                )
                if not company:
                    company = Company(name=row["company"])
                    session.add(company)
                    await session.flush()
                password = None
                if row.get("provider") == "inbox_eu":
                    key = row.get("password_env", "")
                    if not re.fullmatch(r"MAILBOX_[A-Z0-9_]+", key):
                        raise ValueError(
                            f"Строка {line}: укажите имя переменной MAILBOX_..."
                        )
                    password = os.environ.get(key)
                    if not password:
                        raise ValueError(
                            f"Строка {line}: нет пароля приложения в переменной {key}"
                        )
                try:
                    data = AccountInput(
                        company_id=company.id,
                        provider=row.get("provider"),
                        email=row.get("email"),
                        display_name=row.get("display_name", ""),
                        organization_id=row.get("organization_id")
                        or settings().zoho_organization_id
                        or None,
                        imap_user=row.get("imap_user") or row.get("email"),
                        imap_password=password,
                    )
                except ValidationError:
                    raise ValueError(f"Строка {line}: неверные поля CSV") from None
                existing = await session.scalar(
                    select(MailAccount).where(
                        MailAccount.email == str(data.email).lower()
                    )
                )
                if existing:
                    if (
                        existing.provider != data.provider
                        or existing.company_id != company.id
                    ):
                        raise ValueError(
                            f"Строка {line}: ящик уже связан с другой компанией или провайдером"
                        )
                    skipped += 1
                    continue
                if data.provider == "zoho_eu" and not data.organization_id:
                    raise ValueError(f"Строка {line}: нужен organization_id Zoho")
                account = MailAccount(**data.model_dump(exclude={"imap_password"}))
                account.email = account.email.lower()
                if password:
                    account.imap_pass_enc = encrypt(password)
                    account.imap_host = "mail.inbox.eu"
                    account.imap_port = 993
                    account.smtp_host = "mail.inbox.eu"
                    account.smtp_port = 465
                session.add(account)
                count += 1
            await session.commit()
    finally:
        if handle is not sys.stdin:
            handle.close()
    print(
        f"Добавлено: {count}; уже существовали: {skipped}. OAuth подключите в интерфейсе."
    )


def main():
    parser = argparse.ArgumentParser(description="Управление CRM")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("telegram-webhook")
    importer = commands.add_parser("import-accounts")
    importer.add_argument("--file", required=True, help="CSV path or - for stdin")
    args = parser.parse_args()
    if args.command == "import-accounts":
        asyncio.run(import_accounts(args.file))
    elif args.command == "telegram-webhook":
        asyncio.run(telegram_setup())


if __name__ == "__main__":
    try:
        main()
    except (ValueError, EOFError) as exc:
        sys.exit(str(exc))
