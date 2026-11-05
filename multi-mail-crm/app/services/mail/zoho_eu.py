from datetime import datetime, timedelta, timezone
from email.utils import getaddresses

from app.core.config import settings
from app.core.redis import throttle
from app.services.mail.base import Batch, MailItem, plain_html
from app.services.mail.oauth_base import OAuthProvider

BASE = "https://mail.zoho.eu/api"


class ZohoEUProvider(OAuthProvider):
    token_url = "https://accounts.zoho.eu/oauth/v2/token"

    def __init__(self, account, redis_client, client=None):
        super().__init__(account, client)
        self.redis = redis_client

    def auth_header(self, token):
        return {"Authorization": "Zoho-oauthtoken " + token}

    async def before_request(self):
        organization = self.account.organization_id
        if not organization:
            raise ValueError(
                "Zoho organization_id is required for distributed rate limiting"
            )
        await throttle(
            self.redis,
            "zoho:" + organization,
            min(30, settings().zoho_requests_per_minute),
        )

    def check_response(self, result):
        status = result.get("status", {})
        if isinstance(status, dict) and int(status.get("code", 200)) >= 400:
            raise ValueError("Zoho API rejected request")

    async def account_base(self):
        if not self.account.provider_account_id:
            result = await self.request("GET", BASE + "/accounts")
            for account in result.get("data", []):
                addresses = account.get("emailAddress", [])
                if isinstance(addresses, str):
                    addresses = [addresses]
                if (
                    self.account.email.lower() in [str(a).lower() for a in addresses]
                    or str(account.get("primaryEmailAddress", "")).lower()
                    == self.account.email.lower()
                ):
                    self.account.provider_account_id = str(account["accountId"])
                    break
            if not self.account.provider_account_id:
                raise ValueError(
                    "OAuth identity does not contain configured Zoho mailbox"
                )
        return BASE + "/accounts/" + self.account.provider_account_id

    async def fetch(self, state):
        base = await self.account_base()
        state = dict(state)
        if not state.get("folder_id"):
            folders = (await self.request("GET", base + "/folders")).get("data", [])
            inbox = next(
                (
                    f
                    for f in folders
                    if f.get("folderType") == "Inbox"
                    or f.get("folderName", "").lower() == "inbox"
                ),
                None,
            )
            if not inbox:
                raise ValueError("Zoho Inbox folder not found")
            state["folder_id"] = str(inbox["folderId"])
        cutoff = int(
            state.get(
                "watermark",
                int(
                    (
                        datetime.now(timezone.utc)
                        - timedelta(days=settings().initial_sync_days)
                    ).timestamp()
                    * 1000
                ),
            )
        )
        start = int(state.get("start", 1))
        size = settings().sync_batch_size
        rows = (
            await self.request(
                "GET",
                base + "/messages/view",
                params={
                    "folderId": state["folder_id"],
                    "start": start,
                    "limit": size,
                    "sortBy": "date",
                    "sortorder": "false",
                },
            )
        ).get("data", [])
        items = []
        flags = {}
        max_time = int(state.get("scan_max", cutoff))
        older = False
        for row in rows:
            received = int(row.get("receivedTime", row.get("sentDateInGMT", 0)))
            if received < cutoff:
                older = True
                continue
            rid = str(row["messageId"])
            is_read = str(row.get("status", "0")) == "1"
            flags[rid] = is_read
            max_time = max(max_time, received)
            # The query parameter is critical: classification MUST NOT remove unread.
            content = (
                await self.request(
                    "GET",
                    base + "/messages/" + rid + "/content",
                    params={"markAsRead": "false"},
                )
            ).get("data", {})
            body = content.get("content", "")
            sender = getaddresses([row.get("fromAddress", "")])
            name, address = sender[0] if sender else ("", "")
            recipients = [
                a.lower() for _, a in getaddresses([row.get("toAddress", "")])
            ]
            mid = row.get("headerMessageId") or rid
            items.append(
                MailItem(
                    rid,
                    mid,
                    str(row.get("threadId") or mid),
                    address.lower(),
                    row.get("sender") or name,
                    recipients,
                    row.get("subject", ""),
                    plain_html(body),
                    body,
                    datetime.fromtimestamp(received / 1000, timezone.utc),
                    is_read,
                    {},
                )
            )
        more = len(rows) == size and not older
        if more:
            state.update(start=start + size, scan_max=max_time)
        else:
            state = {"folder_id": state["folder_id"], "watermark": max_time}
        return Batch(items, state, more, flags)

    async def mark_read(self, remote_id, value):
        base = await self.account_base()
        await self.request(
            "PUT",
            base + "/messages",
            json={
                "mode": "markAsRead" if value else "markAsUnread",
                "messageId": [remote_id],
            },
        )

    async def send(self, message, original):
        base = await self.account_base()
        result = await self.request(
            "POST",
            base + "/messages/" + original.remote_id,
            json={
                "fromAddress": self.account.email,
                "toAddress": ",".join(message.to_emails),
                "subject": message.subject,
                "content": message.body_text,
                "mailFormat": "plaintext",
                "action": "reply",
            },
        )
        return str(result.get("data", {}).get("messageId", message.message_id))
