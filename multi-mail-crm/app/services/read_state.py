from sqlalchemy.ext.asyncio import AsyncSession
from app.models import MailAccount, Message
from app.services.events import event


async def request_read(session: AsyncSession, message_id, value: bool):
    message = await session.get(Message, message_id)
    if not message:
        return
    await session.get(MailAccount, message.mail_account_id, with_for_update=True)
    await session.refresh(message, with_for_update=True)
    message.read_revision += 1
    message.desired_read = value
    event(
        session,
        "read.request",
        {
            "message_id": str(message.id),
            "value": value,
            "version": message.read_revision,
        },
    )
