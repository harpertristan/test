import base64
import json
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, or_, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import FlagInput, MessageDetail, MessageView, ReplyInput, TaskInput
from app.core.db import db
from app.core.security import current_user, utcnow
from app.models import CRMTask, Company, MailAccount, Message, Notification, User
from app.services.events import event
from app.services.pending import mark_replied
from app.services.read_state import request_read

router = APIRouter(tags=["messages"])


@router.get("/messages")
async def listing(
    account_id: UUID | None = None,
    company_id: UUID | None = None,
    thread_id: str | None = None,
    cursor: str | None = None,
    limit: int = Query(40, ge=1, le=100),
    unread: bool = False,
    pending: bool = False,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db),
):
    query = select(Message).where(Message.deleted_at.is_(None))
    if account_id:
        query = query.where(Message.mail_account_id == account_id)
    if company_id:
        query = query.where(Message.company_id == company_id)
    if thread_id:
        query = query.where(Message.thread_id == thread_id)
    if unread:
        query = query.where(Message.direction == "in", Message.is_read.is_(False))
    if pending:
        query = query.where(
            Message.needs_reply.is_(True),
            Message.replied_at.is_(None),
            Message.category.in_(("add_request", "other")),
        )
    if cursor:
        try:
            date_value, id_value = json.loads(base64.urlsafe_b64decode(cursor.encode()))
            stamp = datetime.fromisoformat(date_value)
            identifier = UUID(id_value)
            if stamp.tzinfo is None:
                raise ValueError()
        except Exception:
            raise HTTPException(422, "Некорректный курсор") from None
        query = query.where(
            or_(
                Message.received_at < stamp,
                and_(Message.received_at == stamp, Message.id < identifier),
            )
        )
    rows = list(
        (
            await session.scalars(
                query.order_by(Message.received_at.desc(), Message.id.desc()).limit(
                    limit + 1
                )
            )
        ).all()
    )
    more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = (
        base64.urlsafe_b64encode(
            json.dumps([rows[-1].received_at.isoformat(), str(rows[-1].id)]).encode()
        ).decode()
        if more
        else None
    )
    return {
        "items": [MessageView.model_validate(m) for m in rows],
        "next_cursor": next_cursor,
    }


@router.get("/messages/{message_id}", response_model=MessageDetail)
async def detail(
    message_id: UUID,
    _: User = Depends(current_user),
    session: AsyncSession = Depends(db),
):
    message = await session.get(Message, message_id)
    if not message or message.deleted_at:
        raise HTTPException(404, "Письмо не найдено")
    # Reading the detail is intentionally side-effect-free. Only explicit Read marks it.
    return message


@router.delete("/messages/{message_id}", status_code=202)
async def trash(
    message_id: UUID,
    _: User = Depends(current_user),
    session: AsyncSession = Depends(db),
):
    from app.services.trash import request_trash

    message = await session.get(Message, message_id)
    if not message:
        raise HTTPException(404, "Письмо не найдено")
    if message.direction != "in" or not message.remote_id:
        raise HTTPException(400, "Удаление доступно для входящих писем")
    await request_trash(session, message)
    await session.commit()
    return {"status": "queued"}


@router.post("/messages/{message_id}/read", status_code=202)
async def read(
    message_id: UUID,
    data: FlagInput,
    _: User = Depends(current_user),
    session: AsyncSession = Depends(db),
):
    message = await detail(message_id, _, session)
    if message.direction != "in":
        raise HTTPException(400, "Только входящие письма")
    await request_read(session, message.id, data.value)
    await session.commit()
    return {"status": "queued"}


@router.post("/messages/{message_id}/replied", status_code=204)
async def replied(
    message_id: UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db),
):
    message = await detail(message_id, user, session)
    await session.get(MailAccount, message.mail_account_id, with_for_update=True)
    await mark_replied(session, message=message)
    event(
        session,
        "messages.changed",
        {
            "account_id": str(message.mail_account_id),
            "company_id": str(message.company_id),
        },
    )
    await session.commit()


@router.post(
    "/messages/{message_id}/reply", response_model=MessageView, status_code=202
)
async def reply(
    message_id: UUID,
    data: ReplyInput,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db),
):
    original = await detail(message_id, user, session)
    if original.direction != "in" or not original.from_email:
        raise HTTPException(400, "Нельзя ответить на это письмо")
    account = await session.get(
        MailAccount, original.mail_account_id, with_for_update=True
    )
    if not account.is_active:
        raise HTTPException(409, "Ящик выключен")
    existing = await session.get(Message, data.idempotency_key)
    if existing:
        if existing.reply_to_id != message_id or existing.body_text != data.body:
            raise HTTPException(409, "Ключ идемпотентности уже использован")
        return existing
    subject = original.subject or "(без темы)"
    if not subject.lower().startswith("re:"):
        subject = "Re: " + subject
    msg = Message(
        id=data.idempotency_key,
        mail_account_id=account.id,
        company_id=account.company_id,
        direction="out",
        from_email=account.email,
        to_emails=[original.from_email],
        subject=subject,
        body_text=data.body,
        is_read=True,
        thread_id=original.thread_id,
        reply_to_id=original.id,
        received_at=utcnow(),
        send_state="queued",
        processing_state="done",
        message_id=f"<{data.idempotency_key}@{account.email.rsplit('@', 1)[-1]}>",
    )
    session.add(msg)
    event(session, "send.request", {"message_id": str(msg.id)})
    await session.commit()
    return msg


@router.post("/messages/{message_id}/flag", status_code=204)
async def flag(
    message_id: UUID,
    data: FlagInput,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db),
):
    message = await detail(message_id, user, session)
    message.is_flagged = data.value
    event(session, "messages.changed", {"message_id": str(message_id)})
    await session.commit()


@router.get("/tasks")
async def tasks(
    company_id: UUID | None = None,
    _: User = Depends(current_user),
    session: AsyncSession = Depends(db),
):
    query = (
        select(CRMTask).order_by(CRMTask.is_done, CRMTask.created_at.desc()).limit(300)
    )
    if company_id:
        query = query.where(CRMTask.company_id == company_id)
    return list((await session.scalars(query)).all())


@router.post("/tasks", status_code=201)
async def create_task(
    data: TaskInput,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db),
):
    if not await session.get(Company, data.company_id):
        raise HTTPException(404, "Компания не найдена")
    if data.message_id:
        message = await session.get(Message, data.message_id)
        if not message or message.company_id != data.company_id:
            raise HTTPException(422, "Письмо другой компании")
    task = CRMTask(**data.model_dump(), user_id=user.id)
    session.add(task)
    await session.commit()
    await session.refresh(task)
    return task


@router.post("/tasks/{task_id}/done", status_code=204)
async def task_done(
    task_id: UUID,
    data: FlagInput,
    _: User = Depends(current_user),
    session: AsyncSession = Depends(db),
):
    task = await session.get(CRMTask, task_id)
    if not task:
        raise HTTPException(404, "Задача не найдена")
    task.is_done = data.value
    await session.commit()


@router.get("/notifications")
async def notifications(
    user: User = Depends(current_user), session: AsyncSession = Depends(db)
):
    rows = (
        await session.execute(
            select(Notification, Message, MailAccount)
            .join(Message, Message.id == Notification.message_id)
            .join(MailAccount, MailAccount.id == Notification.mail_account_id)
            .where(Notification.user_id == user.id, Message.deleted_at.is_(None))
            .order_by(Notification.created_at.desc())
            .limit(100)
        )
    ).all()
    count = await session.scalar(
        select(func.count())
        .select_from(Notification)
        .join(Message, Message.id == Notification.message_id)
        .where(
            Notification.user_id == user.id,
            Notification.is_seen.is_(False),
            Message.deleted_at.is_(None),
        )
    )
    items = [
        {
            "id": str(n.id),
            "message_id": str(m.id),
            "account_id": str(a.id),
            "email": a.email,
            "subject": m.subject,
            "category": m.category,
            "is_seen": n.is_seen,
            "created_at": n.created_at,
        }
        for n, m, a in rows
    ]
    return {"items": items, "unseen_count": count}


@router.post("/notifications/seen", status_code=204)
async def notifications_seen(
    user: User = Depends(current_user), session: AsyncSession = Depends(db)
):
    from sqlalchemy import update

    await session.execute(
        update(Notification).where(Notification.user_id == user.id).values(is_seen=True)
    )
    await session.commit()
