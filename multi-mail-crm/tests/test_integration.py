from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select, func

from app.core.db import Session
from app.core.redis import Lease, Busy, redis
from app.core.security import encrypt, decrypt, utcnow
from app.models import Company, MailAccount, Message, Notification, Outbox, User
from app.services.classifier.base import Classification
from app.services.mail.base import Batch, MailItem
from app.services.pending import account_status, refresh_needs_reply

pytestmark = pytest.mark.asyncio


async def test_open_workspace_crud_and_encryption(client, admin_user):
    assert (await client.get("/accounts")).status_code == 200
    profile = await client.get("/workspace")
    assert profile.status_code == 200
    assert "set-cookie" not in profile.headers
    assert "password_hash" not in profile.json()
    assert profile.json()["id"] == str(admin_user.id)
    company = await client.post(
        "/companies", json={"name": "Ромашка", "inn": "7700000000"}
    )
    assert company.status_code == 201
    result = await client.post(
        "/accounts",
        json={
            "company_id": company.json()["id"],
            "provider": "inbox_eu",
            "email": "sales@example.com",
            "imap_password": "application-secret",
        },
    )
    assert result.status_code == 201, result.text
    account = result.json()
    assert "imap_pass_enc" not in account and "oauth_token" not in account
    async with Session() as session:
        stored = await session.get(MailAccount, UUID(account["id"]))
        assert decrypt(stored.imap_pass_enc) == "application-secret"
        assert stored.imap_pass_enc != b"application-secret"
    assert (
        await client.post(
            "/accounts/" + account["id"] + "/favorite", json={"value": True}
        )
    ).status_code == 204
    assert (await client.get("/accounts")).json()[0]["is_favorite"] is True
    async with Session() as session:
        assert await session.scalar(select(func.count()).select_from(User)) == 1


async def test_no_login_registration_and_browser_origin_guard(client, admin_user):
    for path in ("/auth/login", "/auth/register", "/auth/logout", "/auth/invite"):
        assert (await client.post(path, json={})).status_code == 404
    assert (await client.get("/users")).status_code == 404
    assert (
        await client.get(
            "/workspace",
            headers={
                "Authorization": "Bearer expired",
                "Cookie": "crm_session=expired",
            },
        )
    ).status_code == 200
    assert (
        await client.post(
            "/companies",
            json={"name": "Blocked"},
            headers={"Origin": "https://attacker.example"},
        )
    ).status_code == 403
    profile = (await client.get("/workspace")).json()
    assert profile["id"] == str(admin_user.id)
    # No hidden session or bootstrap admin is needed for writes.
    client.headers.pop("Origin", None)
    assert (
        await client.post("/companies", json={"name": "Open workspace"})
    ).status_code == 201


async def seed_mail(admin_user, count=1):
    async with Session() as session:
        company = Company(name="Фирма")
        session.add(company)
        await session.flush()
        account = MailAccount(
            company_id=company.id,
            provider="inbox_eu",
            email="sales@example.com",
            imap_pass_enc=encrypt("secret"),
        )
        session.add(account)
        await session.flush()
        ids = []
        for i in range(count):
            message = Message(
                mail_account_id=account.id,
                company_id=company.id,
                direction="in",
                remote_id=str(i),
                message_id=f"<{i}@client>",
                thread_id="thread",
                from_email="client@example.com",
                subject="Запрос",
                body_text="Нужна цена",
                received_at=utcnow() - timedelta(days=3, seconds=i),
                is_read=False,
            )
            session.add(message)
            await session.flush()
            ids.append(message.id)
        await session.commit()
        return company.id, account.id, ids


async def test_processing_priority_reply_and_cursor(client, admin_user, monkeypatch):
    from app.workers import tasks_process
    from app.services.pending import overdue

    cid, aid, ids = await seed_mail(admin_user, 3)
    fake = SimpleNamespace(
        classify=AsyncMock(
            return_value=Classification(
                category="add_request", confidence=0.9, reason="Вопрос"
            )
        )
    )
    monkeypatch.setattr(tasks_process, "classifier_for", lambda _: fake)
    for identifier in ids:
        await tasks_process.process(str(identifier))
    await tasks_process.process(str(ids[0]))  # idempotent: never duplicate notices
    async with Session() as session:
        account = await session.get(MailAccount, aid)
        assert account.unread_count == 3 and account.current_status == "add_request"
        assert await session.scalar(select(func.count()).select_from(Notification)) == 3
        first = await session.get(Message, ids[0])
        assert not first.is_read and overdue(first)
        first.category = "ad"
        first.needs_reply = True
        await session.flush()
        await refresh_needs_reply(session)
        await session.commit()
        assert not (await session.get(Message, ids[0])).needs_reply
    page = (
        await client.get("/messages", params={"company_id": str(cid), "limit": 1})
    ).json()
    assert len(page["items"]) == 1 and page["next_cursor"]
    second = (
        await client.get(
            "/messages",
            params={"company_id": str(cid), "limit": 1, "cursor": page["next_cursor"]},
        )
    ).json()
    assert second["items"][0]["id"] != page["items"][0]["id"]
    assert (await client.post(f"/messages/{ids[1]}/replied")).status_code == 204
    async with Session() as session:
        older = (
            await session.scalars(select(Message).where(Message.mail_account_id == aid))
        ).all()
        assert all(m.replied_at and not m.needs_reply for m in older)
        newer = Message(
            mail_account_id=aid,
            company_id=cid,
            direction="in",
            remote_id="new",
            thread_id="thread",
            from_email="client@example.com",
            subject="Ещё вопрос",
            body_text="Уточните",
            received_at=utcnow(),
        )
        session.add(newer)
        await session.commit()
        new_id = newer.id
    await tasks_process.process(str(new_id))
    async with Session() as session:
        assert (await session.get(Message, new_id)).needs_reply
    key = str(uuid4())
    body = {"body": "Спасибо, направляем КП", "idempotency_key": key}
    first = await client.post(f"/messages/{new_id}/reply", json=body)
    repeat = await client.post(f"/messages/{new_id}/reply", json=body)
    assert first.status_code == 202 and repeat.json()["id"] == key
    assert (
        await client.post(
            f"/messages/{new_id}/reply", json={**body, "body": "different"}
        )
    ).status_code == 409


async def test_ingest_dedup_and_unread_preserved(database, admin_user, monkeypatch):
    from app.workers import tasks_sync

    cid, aid, _ = await seed_mail(admin_user, 0)
    now = utcnow()
    batch = Batch(
        [
            MailItem(
                "remote-1",
                "<remote-1>",
                "root",
                "client@example.com",
                "Client",
                ["sales@example.com"],
                "Subject",
                "Body",
                "",
                now,
                False,
            )
        ],
        {"last_uid": 1},
    )
    provider = SimpleNamespace(fetch=AsyncMock(return_value=batch), close=AsyncMock())
    monkeypatch.setattr(tasks_sync, "provider_for", lambda *_: provider)
    await tasks_sync.sync_once(str(aid))
    await tasks_sync.sync_once(str(aid))
    async with Session() as session:
        messages = (await session.scalars(select(Message))).all()
        assert len(messages) == 1 and not messages[0].is_read
        assert (await session.get(MailAccount, aid)).unread_count == 1
        assert (
            await session.scalar(
                select(func.count())
                .select_from(Outbox)
                .where(Outbox.event_key.like("process:%"))
            )
            == 1
        )


async def test_account_priority_uses_only_unread(database, admin_user):
    cid, aid, ids = await seed_mail(admin_user, 5)
    async with Session() as session:
        for identifier, category in zip(
            ids, ["ad", "other", "approve", "decline", "add_request"]
        ):
            msg = await session.get(Message, identifier)
            msg.category = category
        await account_status(session, aid)
        await session.commit()
        assert (await session.get(MailAccount, aid)).current_status == "add_request"
        (await session.get(Message, ids[-1])).is_read = True
        await account_status(session, aid)
        await session.commit()
        assert (await session.get(MailAccount, aid)).current_status == "decline"


async def test_send_sets_replied_but_does_not_reply_to_newer_message(
    database, admin_user, monkeypatch
):
    from app.workers import tasks_process

    cid, aid, ids = await seed_mail(admin_user)
    async with Session() as session:
        future = Message(
            mail_account_id=aid,
            company_id=cid,
            direction="in",
            remote_id="future",
            thread_id="thread",
            category="other",
            needs_reply=True,
            received_at=utcnow() + timedelta(minutes=1),
        )
        outgoing = Message(
            mail_account_id=aid,
            company_id=cid,
            direction="out",
            thread_id="thread",
            reply_to_id=ids[0],
            body_text="Ответ",
            send_state="queued",
            is_read=True,
            processing_state="done",
            message_id="<reply@example.com>",
        )
        session.add_all([future, outgoing])
        await session.commit()
        out_id = outgoing.id
        future_id = future.id
    provider = SimpleNamespace(
        send=AsyncMock(return_value="sent-remote"), close=AsyncMock()
    )
    monkeypatch.setattr(tasks_process, "provider_for", lambda *_: provider)
    await tasks_process.send(str(out_id))
    await tasks_process.send(str(out_id))
    assert provider.send.await_count == 1
    async with Session() as session:
        assert (await session.get(Message, out_id)).send_state == "sent"
        assert (await session.get(Message, ids[0])).replied_at
        assert (await session.get(Message, future_id)).needs_reply


async def test_telegram_storm_is_single_summary(database, admin_user, monkeypatch):
    from app.workers import tasks_notify

    cid, aid, ids = await seed_mail(admin_user, 6)
    async with Session() as session:
        user = await session.get(User, admin_user.id)
        user.telegram_id = 123456
        await session.flush()
        notice_ids = []
        for mid in ids:
            notice = Notification(user_id=user.id, message_id=mid, mail_account_id=aid)
            session.add(notice)
            await session.flush()
            notice_ids.append(str(notice.id))
        await session.commit()
    fake = SimpleNamespace(
        send_message=AsyncMock(), session=SimpleNamespace(close=AsyncMock())
    )
    monkeypatch.setattr(tasks_notify, "Bot", lambda *_: fake)
    monkeypatch.setattr(
        tasks_notify,
        "settings",
        lambda: SimpleNamespace(
            telegram_bot_token="test",
            public_url="https://crm.example.com",
            app_url="https://crm.example.com/mail-crm",
        ),
    )
    async with redis() as client:
        await client.zadd("tg:buffer:" + str(admin_user.id), {i: 1 for i in notice_ids})
        await client.zadd("tg:due", {str(admin_user.id): 1})
    await tasks_notify.flush_telegram()
    await tasks_notify.flush_telegram()
    assert fake.send_message.await_count == 1
    assert "Новых писем: 6" in fake.send_message.call_args.args[1]
    async with Session() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(Notification)
                .where(Notification.telegram_sent_at.is_not(None))
            )
            == 6
        )


async def test_redis_locks_are_shared(database):
    key = "test:lease:" + uuid4().hex
    async with redis() as first, redis() as second:
        async with Lease(first, key):
            with pytest.raises(Busy):
                async with Lease(second, key):
                    pass
        async with Lease(second, key):
            pass


async def test_read_retry_cannot_override_newer_user_intent(
    database, admin_user, monkeypatch
):
    from app.services.read_state import request_read
    from app.workers import tasks_process

    _, aid, ids = await seed_mail(admin_user)
    async with Session() as session:
        await request_read(session, ids[0], True)
        await session.commit()
        await request_read(session, ids[0], False)
        await session.commit()
    provider = SimpleNamespace(mark_read=AsyncMock(), close=AsyncMock())
    monkeypatch.setattr(tasks_process, "provider_for", lambda *_: provider)
    await tasks_process.set_read(str(ids[0]), True, 1)
    assert provider.mark_read.await_count == 0
    await tasks_process.set_read(str(ids[0]), False, 2)
    provider.mark_read.assert_awaited_once_with("0", False)
    async with Session() as session:
        message = await session.get(Message, ids[0])
        assert not message.is_read and message.desired_read is None


async def test_telegram_one_time_link_and_callback_ownership(database, admin_user):
    from aiogram.filters import CommandObject
    from app.core.security import digest
    from app.services.notify.telegram import link, mark_read

    _, aid, ids = await seed_mail(admin_user)
    token = uuid4().hex
    async with redis() as client:
        await client.set("tg-link:" + digest(token), str(admin_user.id), ex=60)
    incoming = SimpleNamespace(
        chat=SimpleNamespace(type="private"),
        from_user=SimpleNamespace(id=998877),
        answer=AsyncMock(),
    )
    await link(incoming, CommandObject(args=token))
    async with Session() as session:
        assert (await session.get(User, admin_user.id)).telegram_id == 998877
        notice = Notification(
            user_id=admin_user.id, message_id=ids[0], mail_account_id=aid
        )
        session.add(notice)
        await session.commit()
        notice_id = notice.id
    await link(incoming, CommandObject(args=token))
    assert "новый одноразовый" in incoming.answer.call_args.args[0]
    bad = SimpleNamespace(
        data="read:" + str(notice_id),
        from_user=SimpleNamespace(id=112233),
        answer=AsyncMock(),
    )
    await mark_read(bad)
    assert "Нет доступа" in bad.answer.call_args.args[0]
    good = SimpleNamespace(
        data="read:" + str(notice_id),
        from_user=SimpleNamespace(id=998877),
        answer=AsyncMock(),
    )
    await mark_read(good)
    async with Session() as session:
        assert (await session.get(Notification, notice_id)).is_seen
        message = await session.get(Message, ids[0])
        assert message.desired_read is True


@pytest.mark.asyncio
async def test_readiness_tracks_migration_head_and_rejects_stale_schema(client):
    from sqlalchemy import text
    from app.core.schema import expected_schema_revision

    expected = expected_schema_revision()
    response = await client.get("/health/ready")
    assert response.status_code == 200
    assert response.json()["schema"] == expected
    try:
        async with Session() as session:
            await session.execute(text("UPDATE alembic_version SET version_num='0002'"))
            await session.commit()
        response = await client.get("/health/ready")
        assert response.status_code == 503
    finally:
        async with Session() as session:
            await session.execute(
                text("UPDATE alembic_version SET version_num=:revision"),
                {"revision": expected},
            )
            await session.commit()
    assert (await client.get("/health/ready")).status_code == 200


@pytest.mark.asyncio
async def test_message_delete_hides_mail_and_counters_but_keeps_tombstone(
    client, admin_user
):
    from app.services.pending import account_status, refresh_needs_reply

    cid, aid, ids = await seed_mail(admin_user)
    async with Session() as session:
        message = await session.get(Message, ids[0])
        message.category = "add_request"
        message.needs_reply = True
        await session.flush()
        await account_status(session, aid)
        await session.commit()
    response = await client.delete(f"/messages/{ids[0]}")
    assert response.status_code == 202
    assert (await client.delete(f"/messages/{ids[0]}")).status_code == 202
    assert (await client.get(f"/messages/{ids[0]}")).status_code == 404
    assert (await client.get("/messages")).json()["items"] == []
    accounts = (await client.get("/accounts")).json()
    assert accounts[0]["unread_count"] == 0
    assert accounts[0]["pending_count"] == 0
    assert accounts[0]["trash_pending_count"] == 1
    async with Session() as session:
        await refresh_needs_reply(session)
        await session.commit()
        message = await session.get(Message, ids[0])
        assert message.deleted_at and not message.trashed_at and not message.needs_reply
        assert message.remote_id == "0" and message.delete_reason == "manual"


@pytest.mark.asyncio
async def test_automatic_signin_delete_skips_llm_and_notifications(
    client, admin_user, monkeypatch
):
    from app.workers import tasks_process

    cid, aid, ids = await seed_mail(admin_user)
    async with Session() as session:
        message = await session.get(Message, ids[0])
        message.from_email = "support@inbox.eu"
        message.subject = "New sign in from United Kingdom to your email"
        await session.commit()
    classify = Mock(side_effect=AssertionError("No LLM calls for sign-in notices"))
    monkeypatch.setattr(tasks_process, "classifier_for", classify)
    await tasks_process.process(str(ids[0]))
    classify.assert_not_called()
    assert (await client.get("/messages")).json()["items"] == []
    assert (await client.get("/notifications")).json()["unseen_count"] == 0
    async with Session() as session:
        message = await session.get(Message, ids[0])
        assert message.deleted_at and message.delete_reason == "inbox_sign_in"
        assert not message.is_read


@pytest.mark.asyncio
async def test_remote_trash_retries_and_does_not_resurrect_message(
    client, admin_user, monkeypatch
):
    from app.workers import tasks_trash

    cid, aid, ids = await seed_mail(admin_user)
    provider = SimpleNamespace(
        trash=AsyncMock(side_effect=ConnectionError("temporary")), close=AsyncMock()
    )
    monkeypatch.setattr(tasks_trash, "provider_for", lambda *args: provider)
    await client.delete(f"/messages/{ids[0]}")
    await tasks_trash.trash_once(str(ids[0]))
    async with Session() as session:
        message = await session.get(Message, ids[0])
        assert message.deleted_at and not message.trashed_at and message.trash_retry_at
        assert message.trash_error == "ConnectionError"
    provider.trash.side_effect = None
    await tasks_trash.trash_once(str(ids[0]))
    await tasks_trash.trash_once(str(ids[0]))
    assert provider.trash.await_count == 2
    async with Session() as session:
        message = await session.get(Message, ids[0])
        assert message.deleted_at and message.trashed_at and message.trash_error is None
    assert (await client.get("/messages")).json()["items"] == []


@pytest.mark.asyncio
async def test_ingest_signin_notice_starts_in_trash_without_notifications(
    client, admin_user, monkeypatch
):
    from app.workers import tasks_sync
    from app.services.mail.base import Batch, MailItem

    cid, aid, _ = await seed_mail(admin_user, 0)
    item = MailItem(
        "7:11",
        "<signin@inbox.eu>",
        "notice",
        "support@inbox.eu",
        "Inbox.eu",
        ["sales@example.com"],
        "New sign in from Germany to your email",
        "Notice",
        "",
        utcnow(),
        False,
        {},
    )
    provider = SimpleNamespace(
        fetch=AsyncMock(return_value=Batch([item], {"last_uid": 11}, False, {})),
        close=AsyncMock(),
    )
    monkeypatch.setattr(tasks_sync, "provider_for", lambda *args: provider)
    await tasks_sync.sync_once(str(aid))
    await tasks_sync.sync_once(str(aid))  # Dedup retains the deletion tombstone.
    async with Session() as session:
        messages = (
            await session.scalars(select(Message).where(Message.mail_account_id == aid))
        ).all()
        assert len(messages) == 1
        message = messages[0]
        assert message.deleted_at and message.delete_reason == "inbox_sign_in"
        assert message.processing_state == "done" and message.is_read is False
        assert (await session.get(MailAccount, aid)).unread_count == 0
        assert await session.scalar(select(func.count()).select_from(Notification)) == 0
    assert (await client.get("/messages")).json()["items"] == []
