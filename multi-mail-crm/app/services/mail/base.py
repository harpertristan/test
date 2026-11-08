import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.message import EmailMessage
from email.parser import BytesParser
from email.policy import default
from email.utils import getaddresses, parsedate_to_datetime
from html.parser import HTMLParser


@dataclass
class MailItem:
    remote_id: str
    message_id: str
    thread_id: str
    from_email: str
    from_name: str
    to_emails: list[str]
    subject: str
    body_text: str
    body_html: str
    received_at: datetime
    is_read: bool = False
    headers: dict = field(default_factory=dict)


@dataclass
class Batch:
    items: list[MailItem]
    state: dict
    more: bool = False
    read_flags: dict[str, bool] = field(default_factory=dict)


class PlainHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.hidden += 1
        if tag in ("p", "br", "div", "li"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def plain_html(value: str) -> str:
    parser = PlainHTML()
    parser.feed(value)
    return "".join(parser.parts)


def parse_mime(
    raw: bytes, remote_id: str, is_read: bool = False, thread_id: str = ""
) -> MailItem:
    msg = BytesParser(policy=default).parsebytes(raw)
    sender = getaddresses([str(msg.get("From", ""))])
    name, address = sender[0] if sender else ("", "")
    text_parts = []
    html_parts = []
    for part in msg.walk():
        if part.is_multipart() or part.get_content_disposition() == "attachment":
            continue
        if part.get_content_type() not in ("text/plain", "text/html"):
            continue
        payload = part.get_payload(decode=True) or b""
        try:
            body = payload.decode(
                part.get_content_charset() or "utf-8", errors="replace"
            )
        except LookupError:
            body = payload.decode("utf-8", errors="replace")
        (html_parts if part.get_content_type() == "text/html" else text_parts).append(
            body
        )
    html = "\n".join(html_parts)
    text = "\n".join(text_parts) or plain_html(html)
    try:
        stamp = parsedate_to_datetime(str(msg.get("Date", "")))
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError, OverflowError):
        stamp = datetime.now(timezone.utc)
    message_id = str(msg.get("Message-ID", "")) or f"<{remote_id}@unknown>"
    references = re.findall(r"<[^>]+>", str(msg.get("References", "")))
    root = (
        references[0] if references else str(msg.get("In-Reply-To", "")) or message_id
    )
    return MailItem(
        remote_id,
        message_id,
        thread_id or root,
        address.lower(),
        name,
        [a.lower() for _, a in getaddresses(msg.get_all("To", []))],
        str(msg.get("Subject", "")),
        text[:1000000],
        html[:1000000],
        stamp.astimezone(timezone.utc),
        is_read,
        {
            k: str(msg.get(k, ""))[:8000]
            for k in ("Message-ID", "In-Reply-To", "References", "Reply-To")
        },
    )


def reply_mime(account_email: str, message, original) -> bytes:
    result = EmailMessage()
    result["From"] = account_email
    result["To"] = ", ".join(message.to_emails)
    result["Subject"] = message.subject
    result["Message-ID"] = message.message_id
    if original.message_id:
        result["In-Reply-To"] = original.message_id
        references = (original.raw_headers or {}).get("References", "")
        result["References"] = (references + " " + original.message_id).strip()[-8000:]
    result.set_content(message.body_text)
    return result.as_bytes()


class MailProvider(ABC):
    @abstractmethod
    async def fetch(self, state: dict) -> Batch: ...
    @abstractmethod
    async def mark_read(self, remote_id: str, value: bool) -> None: ...
    @abstractmethod
    async def send(self, message, original) -> str: ...
    async def trash(self, remote_id: str, *, mark_read: bool = False) -> None:
        raise NotImplementedError("Provider does not implement trash")

    async def renew_push(self, state: dict) -> dict:
        return state

    async def close(self):
        pass
