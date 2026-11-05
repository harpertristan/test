import uuid
from datetime import datetime

from sqlalchemy import (
    ARRAY,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Identity:
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )


class Created:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class User(Identity, Created, Base):
    __tablename__ = "users"
    email: Mapped[str] = mapped_column(Text, unique=True)
    full_name: Mapped[str | None] = mapped_column(Text)
    role: Mapped[str] = mapped_column(
        Text, default="operator", server_default="operator"
    )
    password_hash: Mapped[str] = mapped_column(Text)
    telegram_id: Mapped[int | None] = mapped_column(BigInteger, unique=True)
    tg_linked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true")
    )
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    __table_args__ = (
        CheckConstraint("role IN ('admin','operator')", name="ck_user_role"),
    )


class Company(Identity, Created, Base):
    __tablename__ = "companies"
    name: Mapped[str] = mapped_column(Text)
    inn: Mapped[str | None] = mapped_column(Text)
    website: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(Text)
    address: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    is_flagged: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false")
    )


class MailAccount(Identity, Created, Base):
    __tablename__ = "mail_accounts"
    company_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("companies.id", ondelete="RESTRICT"), index=True
    )
    provider: Mapped[str] = mapped_column(Text)
    email: Mapped[str] = mapped_column(Text, unique=True)
    display_name: Mapped[str | None] = mapped_column(Text)
    oauth_token: Mapped[dict | None] = mapped_column(JSONB)
    organization_id: Mapped[str | None] = mapped_column(Text)
    provider_account_id: Mapped[str | None] = mapped_column(Text)
    sync_state: Mapped[dict] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    imap_host: Mapped[str | None] = mapped_column(Text)
    imap_port: Mapped[int | None] = mapped_column(Integer)
    imap_user: Mapped[str | None] = mapped_column(Text)
    imap_pass_enc: Mapped[bytes | None] = mapped_column(LargeBinary)
    smtp_host: Mapped[str | None] = mapped_column(Text)
    smtp_port: Mapped[int | None] = mapped_column(Integer)
    last_uid: Mapped[int | None] = mapped_column(BigInteger)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true")
    )
    unread_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    current_status: Mapped[str | None] = mapped_column(Text)
    last_unread_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        CheckConstraint(
            "provider IN ('zoho_eu','gmail','inbox_eu','imap_inbox')",
            name="ck_account_provider",
        ),
    )


class AccountPreference(Base):
    __tablename__ = "account_preferences"
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    mail_account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("mail_accounts.id", ondelete="CASCADE"), primary_key=True
    )
    is_favorite: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false")
    )


class Message(Identity, Base):
    __tablename__ = "messages"
    mail_account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("mail_accounts.id", ondelete="CASCADE")
    )
    company_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("companies.id", ondelete="RESTRICT"), index=True
    )
    direction: Mapped[str] = mapped_column(Text)
    remote_id: Mapped[str | None] = mapped_column(Text)
    message_id: Mapped[str | None] = mapped_column(Text)
    thread_id: Mapped[str | None] = mapped_column(Text, index=True)
    from_email: Mapped[str | None] = mapped_column(Text)
    from_name: Mapped[str | None] = mapped_column(Text)
    to_emails: Mapped[list[str]] = mapped_column(
        ARRAY(Text), default=list, server_default=text("'{}'")
    )
    subject: Mapped[str | None] = mapped_column(Text)
    body_text: Mapped[str | None] = mapped_column(Text)
    body_html: Mapped[str | None] = mapped_column(Text)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    is_read: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false")
    )
    is_flagged: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false")
    )
    read_revision: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    desired_read: Mapped[bool | None] = mapped_column(Boolean)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    trashed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    trash_retry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delete_reason: Mapped[str | None] = mapped_column(Text)
    trash_error: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(Text)
    category_conf: Mapped[float | None] = mapped_column(Float)
    category_reason: Mapped[str | None] = mapped_column(Text)
    classified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    replied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    needs_reply: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false")
    )
    ai_handled: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false")
    )
    ai_draft: Mapped[str | None] = mapped_column(Text)
    raw_headers: Mapped[dict] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    processing_state: Mapped[str] = mapped_column(
        Text, default="pending", server_default="pending"
    )
    send_state: Mapped[str | None] = mapped_column(Text)
    send_error: Mapped[str | None] = mapped_column(Text)
    reply_to_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL")
    )
    __table_args__ = (
        Index(
            "idx_msg_trash_pending",
            "trash_retry_at",
            postgresql_where=text("deleted_at IS NOT NULL AND trashed_at IS NULL"),
        ),
        UniqueConstraint("mail_account_id", "remote_id", name="uq_message_remote"),
        CheckConstraint("direction IN ('in','out')", name="ck_message_direction"),
        CheckConstraint(
            "category IS NULL OR category IN ('ad','add_request','approve','decline','other')",
            name="ck_message_category",
        ),
        CheckConstraint(
            "category_conf IS NULL OR (category_conf >= 0 AND category_conf <= 1)",
            name="ck_message_conf",
        ),
        Index(
            "idx_msg_acc_recv", "mail_account_id", received_at.desc(), text("id DESC")
        ),
        Index(
            "idx_msg_company_recv", "company_id", received_at.desc(), text("id DESC")
        ),
        Index(
            "idx_msg_unread",
            "mail_account_id",
            postgresql_where=text("is_read = false"),
        ),
        Index(
            "idx_msg_pending",
            "received_at",
            postgresql_where=text("needs_reply = true AND replied_at IS NULL"),
        ),
        Index(
            "idx_msg_processing",
            "processing_state",
            postgresql_where=text("direction = 'in' AND processing_state = 'pending'"),
        ),
    )


class Notification(Identity, Created, Base):
    __tablename__ = "notifications"
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    message_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE")
    )
    mail_account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("mail_accounts.id", ondelete="CASCADE")
    )
    is_seen: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false")
    )
    telegram_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        UniqueConstraint("user_id", "message_id", name="uq_notification_user_message"),
    )


class AIRule(Identity, Base):
    __tablename__ = "ai_rules"
    mail_account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("mail_accounts.id", ondelete="CASCADE")
    )
    name: Mapped[str | None] = mapped_column(Text)
    match_from: Mapped[str | None] = mapped_column(Text)
    match_subject: Mapped[str | None] = mapped_column(Text)
    match_keywords: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    action: Mapped[str | None] = mapped_column(Text)
    prompt: Mapped[str | None] = mapped_column(Text)
    template: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true")
    )


class Outbox(Identity, Created, Base):
    __tablename__ = "outbox"
    event_key: Mapped[str] = mapped_column(Text, unique=True)
    payload: Mapped[dict] = mapped_column(JSONB)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        Index(
            "idx_outbox_pending",
            "created_at",
            postgresql_where=text("delivered_at IS NULL"),
        ),
    )


class CRMTask(Identity, Created, Base):
    __tablename__ = "crm_tasks"
    company_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), index=True
    )
    message_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    title: Mapped[str] = mapped_column(Text)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_done: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false")
    )
