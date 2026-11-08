from sqlalchemy import update

from app.core.security import utcnow
from app.models import MailAccount, Notification
from app.services.events import event
from app.services.pending import account_status
from app.services.mail_rules import AUTO_TRASH_REASONS


async def request_trash(session, message, reason="manual"):
    # Same account lock as classification, replies and status reconciliation.
    await session.get(MailAccount, message.mail_account_id, with_for_update=True)
    await session.refresh(message, with_for_update=True)
    if message.deleted_at:
        return
    message.deleted_at = utcnow()
    message.delete_reason = reason
    if reason in AUTO_TRASH_REASONS:
        message.is_read = True
    message.needs_reply = False
    message.desired_read = None
    message.processing_state = "done"
    await session.execute(
        update(Notification)
        .where(Notification.message_id == message.id)
        .values(is_seen=True)
    )
    event(session, "trash.request", {"message_id": str(message.id)})
    event(
        session,
        "messages.deleted",
        {"message_id": str(message.id), "account_id": str(message.mail_account_id)},
    )
    await session.flush()
    await account_status(session, message.mail_account_id)
