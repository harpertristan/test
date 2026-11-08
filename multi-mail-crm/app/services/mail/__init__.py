from app.services.mail.gmail import GmailProvider
from app.services.mail.inbox_eu import InboxEUProvider
from app.services.mail.zoho_eu import ZohoEUProvider


def provider_for(account, redis_client):
    if account.provider == "gmail":
        return GmailProvider(account)
    if account.provider == "zoho_eu":
        return ZohoEUProvider(account, redis_client)
    if account.provider == "inbox_eu":
        return InboxEUProvider(account, redis_client)
    raise ValueError("Unsupported provider")
