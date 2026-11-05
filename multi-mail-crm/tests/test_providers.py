import base64
import json
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from app.core.security import encrypt, encrypt_tokens
from app.services.mail.base import parse_mime
from app.services.mail.gmail import GmailProvider
from app.services.mail.inbox_eu import InboxEUProvider
from app.services.mail.zoho_eu import ZohoEUProvider

RAW = b"From: Client <client@example.com>\r\nTo: sales@example.com\r\nMessage-ID: <new@example.com>\r\nReferences: <root@example.com>\r\nSubject: Quote\r\nDate: Wed, 04 Nov 2026 10:00:00 +0000\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nNeed quote"


def account(provider):
    return SimpleNamespace(
        provider=provider,
        email="sales@example.com",
        organization_id="org-1",
        provider_account_id="123",
        oauth_token=encrypt_tokens(
            {
                "access_token": "test-access",
                "refresh_token": "test-refresh",
                "expires_at": time.time() + 3600,
            }
        ),
        imap_host="mail.inbox.eu",
        smtp_host="mail.inbox.eu",
        imap_user="sales@example.com",
        imap_pass_enc=encrypt("test-app-password"),
    )


def test_mime_thread_and_text():
    mail = parse_mime(RAW, "55")
    assert mail.from_email == "client@example.com" and mail.body_text == "Need quote"
    assert mail.thread_id == "<root@example.com>" and not mail.is_read


@pytest.mark.asyncio
async def test_gmail_get_preserves_unread():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(
            200,
            json={
                "id": "g1",
                "threadId": "t1",
                "raw": base64.urlsafe_b64encode(RAW).decode(),
                "labelIds": ["INBOX", "UNREAD"],
                "internalDate": "1793786400000",
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        mail = await GmailProvider(account("gmail"), client).get_message("g1")
    assert not mail.is_read and mail.thread_id == "t1"
    assert (
        len(calls) == 1
        and calls[0].method == "GET"
        and calls[0].url.params["format"] == "raw"
    )
    assert "/modify" not in str(calls[0].url)


@pytest.mark.asyncio
async def test_gmail_history_read_flag_and_cursor():
    def handler(request):
        return httpx.Response(
            200,
            json={
                "historyId": "200",
                "history": [
                    {
                        "labelsRemoved": [
                            {"message": {"id": "old"}, "labelIds": ["UNREAD"]}
                        ]
                    }
                ],
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        batch = await GmailProvider(account("gmail"), client).fetch(
            {"history_id": "100"}
        )
    assert batch.state["history_id"] == "200" and batch.read_flags == {"old": True}


@pytest.mark.asyncio
async def test_zoho_eu_false_and_shared_organization_limit(monkeypatch):
    calls = []
    limiter = AsyncMock()
    monkeypatch.setattr("app.services.mail.zoho_eu.throttle", limiter)

    def handler(request):
        calls.append(request)
        if request.url.path.endswith("/folders"):
            return httpx.Response(
                200, json={"data": [{"folderId": "inbox", "folderType": "Inbox"}]}
            )
        if request.url.path.endswith("/view"):
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "messageId": "z1",
                            "receivedTime": "1793786400000",
                            "fromAddress": "client@example.com",
                            "toAddress": "sales@example.com",
                            "status": "0",
                            "subject": "Quote",
                        }
                    ]
                },
            )
        return httpx.Response(200, json={"data": {"content": "<p>Need quote</p>"}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        batch = await ZohoEUProvider(account("zoho_eu"), None, client).fetch(
            {"watermark": 0}
        )
    content = next(c for c in calls if c.url.path.endswith("/content"))
    assert (
        content.url.host == "mail.zoho.eu"
        and content.url.params["markAsRead"] == "false"
    )
    assert all(c.method == "GET" for c in calls)
    assert not batch.items[0].is_read
    assert all(c.args[1:] == ("zoho:org-1", 30) for c in limiter.await_args_list)


@pytest.mark.asyncio
async def test_expired_oauth_refresh_uses_eu_and_persists_encrypted():
    from app.core.security import decrypt_tokens

    a = account("zoho_eu")
    a.oauth_token = encrypt_tokens({"refresh_token": "refresh", "expires_at": 0})
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(
            200, json={"access_token": "new-token", "expires_in": 3600}
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = ZohoEUProvider(a, None, client)
        assert await provider.access() == "new-token"
    assert calls[0].url.host == "accounts.zoho.eu"
    assert "new-token" not in json.dumps(a.oauth_token)
    assert decrypt_tokens(a.oauth_token)["refresh_token"] == "refresh"


@pytest.mark.asyncio
async def test_imap_examine_and_body_peek(monkeypatch):
    calls = []

    class FakeIMAP:
        def select(self, folder, readonly=False):
            calls.append(("select", folder, readonly))
            return "OK", [b"1"]

        def response(self, name):
            return name, [b"7"]

        def uid(self, method, *args):
            calls.append((method, *args))
            if method == "search":
                return "OK", [b"11"]
            if method == "fetch":
                return "OK", [
                    (
                        b'1 (UID 11 RFC822.SIZE 400 FLAGS () INTERNALDATE "05-Nov-2026 12:00:00 +0000"',
                        RAW,
                    ),
                    b")",
                ]
            raise AssertionError("No STORE allowed while reading")

        def logout(self):
            pass

    provider = InboxEUProvider(account("inbox_eu"), None)
    monkeypatch.setattr(provider, "connection", FakeIMAP)
    batch = provider.fetch_blocking({"last_uid": 10, "uidvalidity": "7"})
    assert calls[0] == ("select", "INBOX", True)
    assert any("BODY.PEEK[]" in c[-1] for c in calls if c[0] == "fetch")
    assert not batch.items[0].is_read and batch.items[0].remote_id == "7:11"
    assert batch.state["last_uid"] == 11
    assert batch.items[0].received_at.day == 5


@pytest.mark.asyncio
async def test_imap_uidvalidity_resets_cursor(monkeypatch):
    class Fake:
        def select(self, *args, **kwargs):
            return "OK", []

        def response(self, *args):
            return "UIDVALIDITY", [b"new"]

        def uid(self, *args):
            return "OK", [b""]

        def logout(self):
            pass

    provider = InboxEUProvider(account("inbox_eu"), None)
    monkeypatch.setattr(provider, "connection", Fake)
    batch = provider.fetch_blocking({"last_uid": 100, "uidvalidity": "old"})
    assert batch.state == {"last_uid": 0, "uidvalidity": "new"}


def test_inbox_eu_connects_with_full_email_and_verified_tls(monkeypatch):
    from unittest.mock import Mock
    import ssl

    connection = Mock()
    factory = Mock(return_value=connection)
    monkeypatch.setattr("app.services.mail.inbox_eu.imaplib.IMAP4_SSL", factory)
    provider = InboxEUProvider(account("inbox_eu"), None)
    assert provider.connection() is connection
    args, kwargs = factory.call_args
    assert args == ("mail.inbox.eu", 993)
    assert kwargs["ssl_context"].verify_mode == ssl.CERT_REQUIRED
    connection.login.assert_called_once_with("sales@example.com", "test-app-password")


@pytest.mark.asyncio
async def test_inbox_eu_smtp_endpoint_and_credentials(monkeypatch):
    send = AsyncMock()
    monkeypatch.setattr("app.services.mail.inbox_eu.aiosmtplib.send", send)
    monkeypatch.setattr("app.services.mail.inbox_eu.reply_mime", lambda *args: "mime")
    provider = InboxEUProvider(account("inbox_eu"), None)
    result = await provider.send(SimpleNamespace(message_id="outgoing-id"), None)
    assert result == "outgoing-id"
    assert send.call_args.kwargs["hostname"] == "mail.inbox.eu"
    assert send.call_args.kwargs["port"] == 465
    assert send.call_args.kwargs["use_tls"] is True
    assert send.call_args.kwargs["validate_certs"] is True


def test_supported_new_account_providers():
    from app.api.schemas import AccountInput
    from pydantic import ValidationError
    from uuid import uuid4

    fields = dict(company_id=uuid4(), email="sales@inbox.eu")
    for provider in ["inbox_eu", "zoho_eu", "gmail"]:
        assert AccountInput(provider=provider, **fields).provider == provider
    with pytest.raises(ValidationError):
        AccountInput(provider="imap_inbox", **fields)


@pytest.mark.parametrize("capabilities", [(b"MOVE",), (b"UIDPLUS",)])
def test_imap_trash_targets_only_requested_uid_and_keeps_trash_copy(
    monkeypatch, capabilities
):
    calls = []

    class Fake:
        def __init__(self):
            self.capabilities = capabilities

        def select(self, folder, readonly=False):
            assert folder == "INBOX" and readonly is False
            return "OK", []

        def response(self, name):
            return name, [b"7"]

        def list(self):
            return "OK", [
                b'(\\HasNoChildren) "/" "INBOX"',
                b'(\\HasNoChildren \\Trash) "/" "Deleted Items"',
            ]

        def uid(self, command, *args):
            calls.append((command, *args))
            return ("OK", [b"11"]) if command == "search" else ("OK", [])

        def logout(self):
            pass

    provider = InboxEUProvider(account("inbox_eu"), None)
    monkeypatch.setattr(provider, "connection", Fake)
    provider.trash_blocking("7:11")
    mutations = [call for call in calls if call[0] != "search"]
    if b"MOVE" in capabilities:
        assert mutations == [("MOVE", "11", '"Deleted Items"')]
    else:
        assert mutations == [
            ("COPY", "11", '"Deleted Items"'),
            ("STORE", "11", "+FLAGS.SILENT", "(\\Deleted)"),
            ("EXPUNGE", "11"),
        ]
    assert all(call[1] == "11" for call in mutations)
    assert all("\\Seen" not in str(call) for call in mutations)


def test_imap_trash_refuses_reused_uidvalidity(monkeypatch):
    from unittest.mock import Mock

    mailbox = Mock()
    mailbox.select.return_value = ("OK", [])
    mailbox.response.return_value = ("UIDVALIDITY", [b"new"])
    provider = InboxEUProvider(account("inbox_eu"), None)
    monkeypatch.setattr(provider, "connection", lambda: mailbox)
    with pytest.raises(ValueError, match="UIDVALIDITY"):
        provider.trash_blocking("7:11")
    mailbox.uid.assert_not_called()


def test_imap_trash_retry_missing_message_is_success(monkeypatch):
    from unittest.mock import Mock

    mailbox = Mock()
    mailbox.select.return_value = ("OK", [])
    mailbox.response.return_value = ("UIDVALIDITY", [b"7"])
    mailbox.uid.return_value = ("OK", [b""])
    provider = InboxEUProvider(account("inbox_eu"), None)
    monkeypatch.setattr(provider, "connection", lambda: mailbox)
    provider.trash_blocking("7:11")
    mailbox.list.assert_not_called()
    assert mailbox.uid.call_count == 1


@pytest.mark.asyncio
async def test_gmail_trash_uses_recoverable_endpoint(monkeypatch):
    provider = GmailProvider(account("gmail"))
    provider.request = AsyncMock(return_value={})
    await provider.trash("mail-123")
    provider.request.assert_awaited_once_with(
        "POST", "https://gmail.googleapis.com/gmail/v1/users/me/messages/mail-123/trash"
    )
    await provider.close()


@pytest.mark.asyncio
async def test_zoho_trash_moves_to_trash_folder_in_eu(monkeypatch):
    provider = ZohoEUProvider(account("zoho_eu"), None)
    provider.request = AsyncMock(
        side_effect=[
            {"data": [{"folderType": "Trash", "folderId": "trash-folder"}]},
            {},
        ]
    )
    await provider.trash("message-123")
    assert provider.request.call_args.args == (
        "PUT",
        "https://mail.zoho.eu/api/accounts/123/updatemessage",
    )
    assert provider.request.call_args.kwargs["json"] == {
        "mode": "moveMessage",
        "messageId": ["message-123"],
        "destfolderId": "trash-folder",
    }
    await provider.close()


def test_imap_trash_does_not_remove_original_if_trash_copy_fails(monkeypatch):
    from unittest.mock import Mock

    mailbox = Mock()
    mailbox.capabilities = (b"UIDPLUS",)
    mailbox.select.return_value = ("OK", [])
    mailbox.response.return_value = ("UIDVALIDITY", [b"7"])
    mailbox.list.return_value = ("OK", [b'(\\Trash) "/" "Trash"'])
    mailbox.uid.side_effect = [("OK", [b"11"]), ("NO", [b"Mailbox quota exceeded"])]
    provider = InboxEUProvider(account("inbox_eu"), None)
    monkeypatch.setattr(provider, "connection", lambda: mailbox)
    with pytest.raises(RuntimeError, match="copy to Trash failed"):
        provider.trash_blocking("7:11")
    assert [call.args[0] for call in mailbox.uid.call_args_list] == ["search", "COPY"]
