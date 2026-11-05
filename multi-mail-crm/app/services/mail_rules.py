"""Explicit deterministic rules, independent of the LLM classifier."""

import re

_SIGN_IN = re.compile(r"New sign in from [^\r\n]+ to your email", re.IGNORECASE)


def is_sign_in_notice(sender: str | None, subject: str | None) -> bool:
    return bool(
        (sender or "").strip().lower() == "support@inbox.eu"
        and _SIGN_IN.fullmatch((subject or "").strip())
    )
