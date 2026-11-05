from app.services.mail.gmail import GmailProvider
from app.services.mail.imap_inbox import InboxIMAPProvider
from app.services.mail.zoho_eu import ZohoEUProvider


def provider_for(account, redis_client):
    if account.provider == "gmail":
        return GmailProvider(account)
    if account.provider == "zoho_eu":
        return ZohoEUProvider(account, redis_client)
    if account.provider == "imap_inbox":
        return InboxIMAPProvider(account, redis_client)
    raise ValueError("Unsupported provider")
