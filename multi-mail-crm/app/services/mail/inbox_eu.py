import asyncio
import imaplib
import re
import ssl
from datetime import datetime, timedelta, timezone

import aiosmtplib

from app.core.config import settings
from app.core.redis import Semaphore
from app.core.security import decrypt
from app.services.mail.base import Batch, parse_mime, reply_mime, MailProvider


class InboxEUProvider(MailProvider):
    def __init__(self, account, redis_client):
        self.account = account
        self.redis = redis_client

    def connection(self):
        if self.account.imap_host not in (
            None,
            "mail.inbox.eu",
        ) or self.account.smtp_host not in (None, "mail.inbox.eu"):
            raise ValueError(
                "Only the configured Inbox.eu IMAP/SMTP endpoints are supported"
            )
        mailbox = imaplib.IMAP4_SSL(
            "mail.inbox.eu", 993, ssl_context=ssl.create_default_context(), timeout=30
        )
        mailbox.login(
            self.account.imap_user or self.account.email,
            decrypt(self.account.imap_pass_enc),
        )
        return mailbox

    def fetch_blocking(self, state):
        state = dict(state)
        mailbox = self.connection()
        try:
            # readonly=True selects EXAMINE, adding protection against accidental flag writes.
            status, _ = mailbox.select("INBOX", readonly=True)
            if status != "OK":
                raise RuntimeError("IMAP INBOX unavailable")
            validity = (mailbox.response("UIDVALIDITY")[1] or [b""])[0].decode()
            last = (
                int(state.get("last_uid", 0))
                if state.get("uidvalidity") == validity
                else 0
            )
            since = (
                datetime.now(timezone.utc)
                - timedelta(days=settings().initial_sync_days)
            ).strftime("%d-%b-%Y")
            criterion = f"(UID {last + 1}:*)" if last else f"(SINCE {since})"
            status, data = mailbox.uid("search", None, criterion)
            if status != "OK":
                raise RuntimeError("IMAP UID search failed")
            identifiers = sorted(int(uid) for uid in data[0].split() if int(uid) > last)
            items = []
            for uid in identifiers[: settings().sync_batch_size]:
                status, size_parts = mailbox.uid("fetch", str(uid), "(RFC822.SIZE)")
                if status != "OK":
                    raise RuntimeError("IMAP size fetch failed")
                metadata = b" ".join(
                    p[0] if isinstance(p, tuple) else p
                    for p in size_parts
                    if isinstance(p, (bytes, tuple))
                )
                match = re.search(rb"RFC822.SIZE (\d+)", metadata)
                too_large = bool(
                    match and int(match.group(1)) > settings().max_message_bytes
                )
                section = "BODY.PEEK[HEADER]" if too_large else "BODY.PEEK[]"
                status, parts = mailbox.uid(
                    "fetch", str(uid), f"(FLAGS INTERNALDATE {section})"
                )
                if status != "OK":
                    raise RuntimeError("IMAP fetch failed")
                tuples = [p for p in parts if isinstance(p, tuple)]
                if not tuples:
                    continue
                meta, raw = tuples[0]
                if too_large:
                    raw = (
                        raw.split(b"\r\n\r\n", 1)[0]
                        + b"\r\n\r\n[Message exceeds configured import size]"
                    )
                item = parse_mime(raw, f"{validity}:{uid}", b"\\Seen" in meta)
                internal = re.search(rb'INTERNALDATE "([^"]+)"', meta)
                if internal:
                    item.received_at = datetime.strptime(
                        internal.group(1).decode(), "%d-%b-%Y %H:%M:%S %z"
                    ).astimezone(timezone.utc)
                items.append(item)
                last = uid
            # Reconcile externally changed read flags without changing anything remotely.
            status, unseen_data = mailbox.uid("search", None, "UNSEEN")
            if status != "OK":
                raise RuntimeError("IMAP unread search failed")
            unseen = [f"{validity}:{u.decode()}" for u in unseen_data[0].split()]
            state = {"last_uid": last, "uidvalidity": validity}
            return Batch(
                items,
                state,
                len(identifiers) > settings().sync_batch_size,
                {"__unseen__": unseen},
            )
        finally:
            try:
                mailbox.logout()
            except (OSError, imaplib.IMAP4.error):
                pass

    async def fetch(self, state):
        async with Semaphore(
            self.redis, "imap:connections", settings().imap_max_connections
        ):
            return await asyncio.to_thread(self.fetch_blocking, state)

    def read_blocking(self, remote_id, value):
        validity, uid = remote_id.split(":")
        mailbox = self.connection()
        try:
            mailbox.select("INBOX")
            current = (mailbox.response("UIDVALIDITY")[1] or [b""])[0].decode()
            if current != validity:
                raise ValueError(
                    "UIDVALIDITY changed: resync mailbox before marking read"
                )
            status, _ = mailbox.uid(
                "store", uid, "+FLAGS.SILENT" if value else "-FLAGS.SILENT", "(\\Seen)"
            )
            if status != "OK":
                raise RuntimeError("IMAP flag update failed")
        finally:
            try:
                mailbox.logout()
            except (OSError, imaplib.IMAP4.error):
                pass

    async def mark_read(self, remote_id, value):
        async with Semaphore(
            self.redis, "imap:connections", settings().imap_max_connections
        ):
            await asyncio.to_thread(self.read_blocking, remote_id, value)

    async def send(self, message, original):
        await aiosmtplib.send(
            reply_mime(self.account.email, message, original),
            hostname="mail.inbox.eu",
            port=465,
            use_tls=True,
            validate_certs=True,
            username=self.account.imap_user or self.account.email,
            password=decrypt(self.account.imap_pass_enc),
            timeout=30,
        )
        # A successful SMTP response is the commit point. Sent-folder append is deliberately
        # separate from delivery; lack of IMAP append must never cause duplicate SMTP sends.
        return message.message_id
