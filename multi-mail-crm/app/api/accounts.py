from datetime import timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import AccountInput, AccountPatch, AccountView, FlagInput
from app.core.config import settings
from app.core.db import db
from app.core.security import admin, current_user, encrypt, utcnow
from app.models import AccountPreference, Company, MailAccount, Message, User
from app.services.events import event

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.get("", response_model=list[AccountView])
async def listing(
    user: User = Depends(current_user), session: AsyncSession = Depends(db)
):
    overdue = (
        select(
            Message.mail_account_id.label("aid"),
            func.count().label("count"),
            func.min(Message.received_at).label("oldest"),
        )
        .where(
            Message.direction == "in",
            Message.deleted_at.is_(None),
            Message.category.in_(("add_request", "other")),
            Message.needs_reply.is_(True),
            Message.replied_at.is_(None),
            Message.received_at < utcnow() - timedelta(days=2),
        )
        .group_by(Message.mail_account_id)
        .subquery()
    )
    rows = (
        await session.execute(
            select(
                MailAccount,
                Company.name,
                AccountPreference.is_favorite,
                overdue.c.count,
                overdue.c.oldest,
            )
            .join(Company, Company.id == MailAccount.company_id)
            .outerjoin(
                AccountPreference,
                (AccountPreference.mail_account_id == MailAccount.id)
                & (AccountPreference.user_id == user.id),
            )
            .outerjoin(overdue, overdue.c.aid == MailAccount.id)
            .order_by(Company.name, MailAccount.email)
        )
    ).all()
    trash_counts = {
        row.aid: (row.pending, row.errors)
        for row in (
            await session.execute(
                select(
                    Message.mail_account_id.label("aid"),
                    func.count().label("pending"),
                    func.count()
                    .filter(Message.trash_error.is_not(None))
                    .label("errors"),
                )
                .where(Message.deleted_at.is_not(None), Message.trashed_at.is_(None))
                .group_by(Message.mail_account_id)
            )
        ).all()
    }
    result = []
    for account, name, favorite, count, oldest in rows:
        item = AccountView.model_validate(account)
        item.trash_pending_count, item.trash_error_count = trash_counts.get(
            account.id, (0, 0)
        )
        item.company_name = name
        item.is_favorite = bool(favorite)
        item.pending_count = count or 0
        item.oldest_pending_at = oldest
        item.connected = bool(
            account.imap_pass_enc
            if account.provider == "inbox_eu"
            else account.oauth_token
        )
        result.append(item)
    return result


@router.post("", response_model=AccountView, status_code=201)
async def create(
    data: AccountInput, _: User = Depends(admin), session: AsyncSession = Depends(db)
):
    if not await session.get(Company, data.company_id):
        raise HTTPException(404, "Компания не найдена")
    if await session.scalar(
        select(MailAccount.id).where(MailAccount.email == str(data.email).lower())
    ):
        raise HTTPException(409, "Ящик уже существует")
    values = data.model_dump(exclude={"imap_password"})
    values["email"] = str(data.email).lower()
    if data.provider == "zoho_eu":
        values["organization_id"] = (
            data.organization_id or settings().zoho_organization_id
        )
        if not values["organization_id"]:
            raise HTTPException(
                422, "Укажите Zoho organization_id для общего rate limit"
            )
    if data.provider == "inbox_eu":
        if not data.imap_password:
            raise HTTPException(422, "Нужен пароль для почтовой программы Inbox.eu")
        values.update(
            imap_host="mail.inbox.eu",
            imap_port=993,
            smtp_host="mail.inbox.eu",
            smtp_port=465,
            imap_user=data.imap_user or values["email"],
            imap_pass_enc=encrypt(data.imap_password),
        )
    account = MailAccount(**values)
    session.add(account)
    await session.flush()
    event(session, "accounts.changed", {"account_id": str(account.id)})
    await session.commit()
    await session.refresh(account)
    return account


@router.patch("/{account_id}", response_model=AccountView)
async def edit(
    account_id: UUID,
    data: AccountPatch,
    _: User = Depends(admin),
    session: AsyncSession = Depends(db),
):
    account = await session.get(MailAccount, account_id, with_for_update=True)
    if not account:
        raise HTTPException(404, "Ящик не найден")
    if data.company_id and data.company_id != account.company_id:
        if not await session.get(Company, data.company_id):
            raise HTTPException(404, "Компания не найдена")
        await session.execute(
            update(Message)
            .where(Message.mail_account_id == account_id)
            .values(company_id=data.company_id)
        )
    for key, value in data.model_dump(
        exclude_unset=True, exclude={"imap_password"}
    ).items():
        if value is not None:
            setattr(account, key, value)
    if data.imap_password:
        if account.provider != "inbox_eu":
            raise HTTPException(422, "Пароль применим только к IMAP")
        account.imap_pass_enc = encrypt(data.imap_password)
    event(session, "accounts.changed", {"account_id": str(account_id)})
    await session.commit()
    return account


@router.delete("/{account_id}", status_code=204)
async def remove(
    account_id: UUID, _: User = Depends(admin), session: AsyncSession = Depends(db)
):
    account = await session.get(MailAccount, account_id, with_for_update=True)
    if not account:
        raise HTTPException(404, "Ящик не найден")
    await session.delete(account)
    event(session, "accounts.changed", {})
    await session.commit()


@router.post("/{account_id}/favorite", status_code=204)
async def favorite(
    account_id: UUID,
    data: FlagInput,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db),
):
    if not await session.get(MailAccount, account_id):
        raise HTTPException(404, "Ящик не найден")
    await session.execute(
        insert(AccountPreference)
        .values(user_id=user.id, mail_account_id=account_id, is_favorite=data.value)
        .on_conflict_do_update(
            index_elements=["user_id", "mail_account_id"],
            set_={"is_favorite": data.value},
        )
    )
    await session.commit()


@router.post("/{account_id}/sync", status_code=202)
async def sync(
    account_id: UUID, _: User = Depends(admin), session: AsyncSession = Depends(db)
):
    account = await session.get(MailAccount, account_id)
    if not account or not account.is_active:
        raise HTTPException(404, "Активный ящик не найден")
    # Enqueue through durable outbox instead of committing before contacting the broker.
    event(session, "sync.request", {"account_id": str(account_id)})
    await session.commit()
    return {"status": "queued"}
