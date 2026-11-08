import base64
import time
from datetime import datetime, timedelta, timezone

import httpx

from app.core.config import settings
from app.services.mail.base import Batch, parse_mime, reply_mime
from app.services.mail.oauth_base import OAuthProvider

BASE = "https://gmail.googleapis.com/gmail/v1/users/me"


class GmailProvider(OAuthProvider):
    token_url = "https://oauth2.googleapis.com/token"

    async def fetch(self, state):
        state = dict(state)
        items = []
        flags = {}
        batch = settings().sync_batch_size
        if state.get("history_id") and not state.get("page_token"):
            return await self.history(state)
        if not state.get("baseline"):
            state["baseline"] = (await self.request("GET", BASE + "/profile"))[
                "historyId"
            ]
            state["initial_after"] = int(
                (
                    datetime.now(timezone.utc)
                    - timedelta(days=settings().initial_sync_days)
                ).timestamp()
            )
        params = {
            "maxResults": batch,
            "q": f"after:{state['initial_after']} -in:sent -in:trash -in:spam",
        }
        if state.get("page_token"):
            params["pageToken"] = state["page_token"]
        result = await self.request("GET", BASE + "/messages", params=params)
        for ref in result.get("messages", []):
            item = await self.get_message(ref["id"])
            if item:
                items.append(item)
        if result.get("nextPageToken"):
            state["page_token"] = result["nextPageToken"]
            more = True
        else:
            state = {"history_id": state["baseline"]}
            more = False
        return Batch(items, state, more, flags)

    async def get_message(self, remote_id):
        try:
            result = await self.request(
                "GET", BASE + "/messages/" + remote_id, params={"format": "raw"}
            )
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                return None
            raise
        if any(
            label in result.get("labelIds", [])
            for label in ("SENT", "DRAFT", "TRASH", "SPAM")
        ):
            return None
        raw = base64.urlsafe_b64decode(result["raw"] + "===")
        if len(raw) > settings().max_message_bytes:
            raw = (
                raw[: min(len(raw), 100000)]
                + b"\n\n[Message exceeds configured import size]"
            )
        item = parse_mime(
            raw,
            remote_id,
            "UNREAD" not in result.get("labelIds", []),
            result["threadId"],
        )
        item.received_at = datetime.fromtimestamp(
            int(result["internalDate"]) / 1000, timezone.utc
        )
        return item

    async def history(self, state):
        params = {
            "startHistoryId": state["history_id"],
            "maxResults": min(100, settings().sync_batch_size),
        }
        if state.get("history_page"):
            params["pageToken"] = state["history_page"]
        try:
            result = await self.request("GET", BASE + "/history", params=params)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                # Gmail expired history: bounded rescan is deduplicated by remote_id.
                return await self.fetch({})
            raise
        added = set()
        flags = {}
        for entry in result.get("history", []):
            for change in entry.get("messagesAdded", []):
                added.add(change["message"]["id"])
            for kind, is_read in (("labelsAdded", False), ("labelsRemoved", True)):
                for change in entry.get(kind, []):
                    if "UNREAD" in change.get("labelIds", []):
                        flags[change["message"]["id"]] = is_read
            for change in entry.get("messagesDeleted", []):
                flags[change["message"]["id"]] = True
        items = []
        for identifier in sorted(added):
            item = await self.get_message(identifier)
            if item:
                items.append(item)
        new = dict(state)
        if result.get("nextPageToken"):
            new["history_page"] = result["nextPageToken"]
            more = True
        else:
            new = {"history_id": result.get("historyId", state["history_id"])}
            more = False
        return Batch(items, new, more, flags)

    async def mark_read(self, remote_id, value):
        await self.request(
            "POST",
            BASE + "/messages/" + remote_id + "/modify",
            json={
                "removeLabelIds": ["UNREAD"] if value else [],
                "addLabelIds": [] if value else ["UNREAD"],
            },
        )

    async def trash(self, remote_id, *, mark_read=False):
        try:
            if mark_read:
                await self.mark_read(remote_id, True)
            await self.request("POST", BASE + "/messages/" + remote_id + "/trash")
        except httpx.HTTPStatusError as error:
            if error.response.status_code != 404:
                raise

    async def send(self, message, original):
        raw = base64.urlsafe_b64encode(
            reply_mime(self.account.email, message, original)
        ).decode()
        result = await self.request(
            "POST",
            BASE + "/messages/send",
            json={"raw": raw, "threadId": original.thread_id},
        )
        return result["id"]

    async def renew_push(self, state):
        cfg = settings()
        state = dict(state)
        if (
            cfg.gmail_pubsub_topic
            and int(state.get("watch_expiration", 0))
            < int(time.time() * 1000) + 86400000
        ):
            result = await self.request(
                "POST",
                BASE + "/watch",
                json={
                    "topicName": cfg.gmail_pubsub_topic,
                    "labelIds": ["INBOX"],
                    "labelFilterBehavior": "include",
                },
            )
            state["watch_expiration"] = int(result["expiration"])
        return state
