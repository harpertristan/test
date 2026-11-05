"""Explicit deterministic rules, independent of the LLM classifier."""

import re

_SIGN_IN = re.compile(r"New sign in from [^\r\n]+ to your email", re.IGNORECASE)


def is_sign_in_notice(sender: str | None, subject: str | None) -> bool:
    return bool(
        (sender or "").strip().lower() == "support@inbox.eu"
        and _SIGN_IN.fullmatch((subject or "").strip())
    )


AUTO_TRASH_REASONS = ("inbox_sign_in", "inbox_premium")


def auto_trash_reason(sender: str | None, subject: str | None) -> str | None:
    if is_sign_in_notice(sender, subject):
        return "inbox_sign_in"
    if (sender or "").strip().lower() == "orders@inbox.eu" and (
        subject or ""
    ).strip().casefold() == "thank you! premium subscription activated!":
        return "inbox_premium"
    return None
