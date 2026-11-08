from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

Category = Literal["ad", "add_request", "approve", "decline", "other"]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class UserView(ORM):
    id: UUID
    email: str
    full_name: str | None
    role: str
    telegram_id: int | None
    is_active: bool


class CompanyInput(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    inn: str | None = Field(default=None, max_length=32)
    website: str | None = Field(default=None, max_length=2048)
    phone: str | None = Field(default=None, max_length=100)
    address: str | None = Field(default=None, max_length=1000)
    notes: str | None = Field(default=None, max_length=20000)


class CompanyView(ORM, CompanyInput):
    id: UUID
    is_flagged: bool


class AccountInput(BaseModel):
    company_id: UUID
    provider: Literal["zoho_eu", "gmail", "inbox_eu"]
    email: EmailStr
    display_name: str = Field(default="", max_length=200)
    organization_id: str | None = Field(default=None, max_length=100)
    imap_user: str | None = Field(default=None, max_length=320)
    imap_password: str | None = Field(default=None, min_length=1, max_length=1000)
    is_active: bool = True


class AccountPatch(BaseModel):
    company_id: UUID | None = None
    display_name: str | None = Field(default=None, max_length=200)
    organization_id: str | None = Field(default=None, max_length=100)
    imap_user: str | None = Field(default=None, max_length=320)
    imap_password: str | None = Field(default=None, min_length=1, max_length=1000)
    is_active: bool | None = None


class AccountView(ORM):
    id: UUID
    company_id: UUID
    provider: str
    email: str
    display_name: str | None
    organization_id: str | None
    is_active: bool
    unread_count: int
    current_status: str | None
    last_sync_at: datetime | None
    last_error: str | None
    trash_pending_count: int = 0
    trash_error_count: int = 0
    connected: bool = False
    company_name: str = ""
    is_favorite: bool = False
    pending_count: int = 0
    oldest_pending_at: datetime | None = None


class MessageView(ORM):
    id: UUID
    mail_account_id: UUID
    company_id: UUID
    direction: str
    from_email: str | None
    from_name: str | None
    to_emails: list[str]
    subject: str | None
    received_at: datetime
    is_read: bool
    is_flagged: bool
    category: str | None
    category_conf: float | None
    category_reason: str | None
    replied_at: datetime | None
    needs_reply: bool
    thread_id: str | None
    send_state: str | None
    send_error: str | None


class MessageDetail(MessageView):
    body_text: str | None
    body_html: str | None
    ai_handled: bool
    ai_draft: str | None


class ReplyInput(BaseModel):
    idempotency_key: UUID
    body: str = Field(min_length=1, max_length=100000)


class FlagInput(BaseModel):
    value: bool


class TaskInput(BaseModel):
    company_id: UUID
    message_id: UUID | None = None
    title: str = Field(min_length=1, max_length=1000)
    due_at: datetime | None = None

    @field_validator("due_at")
    @classmethod
    def aware(cls, value):
        if value and value.tzinfo is None:
            raise ValueError("Use an ISO timestamp including timezone")
        return value
