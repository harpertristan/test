import pytest
from app.services.mail_rules import is_sign_in_notice


@pytest.mark.parametrize(
    "location",
    [
        "United Kingdom",
        "Germany",
        "Russia",
        "United States",
        "Kaliningrad, Russia",
        "日本",
    ],
)
def test_sign_in_rule_ignores_location(location):
    assert is_sign_in_notice(
        "support@inbox.eu", f"New sign in from {location} to your email"
    )


@pytest.mark.parametrize(
    "sender,subject",
    [
        ("someone@inbox.eu", "New sign in from Germany to your email"),
        ("support@inbox.eu.attacker.com", "New sign in from Germany to your email"),
        ("support@inbox.eu", "Password reset"),
        ("support@inbox.eu", "Re: New sign in from Germany to your email"),
        ("support@inbox.eu", "New sign in from Germany to your email: please respond"),
        ("support@inbox.eu", "New sign in from Germany\nmalicious to your email"),
        (None, None),
    ],
)
def test_sign_in_rule_does_not_match_other_mail(sender, subject):
    assert not is_sign_in_notice(sender, subject)


@pytest.mark.parametrize(
    "sender,subject,expected",
    [
        (
            "orders@inbox.eu",
            "Thank you! Premium subscription activated!",
            "inbox_premium",
        ),
        (
            "ORDERS@INBOX.EU",
            " THANK YOU! PREMIUM SUBSCRIPTION ACTIVATED! ",
            "inbox_premium",
        ),
        ("support@inbox.eu", "New sign in from Germany to your email", "inbox_sign_in"),
        ("orders@inbox.eu", "Your invoice", None),
        (
            "orders@inbox.eu.attacker.com",
            "Thank you! Premium subscription activated!",
            None,
        ),
        ("support@inbox.eu", "Thank you! Premium subscription activated!", None),
        ("orders@inbox.eu", "Re: Thank you! Premium subscription activated!", None),
    ],
)
def test_auto_cleanup_matches_only_explicit_sender_subject_pairs(
    sender, subject, expected
):
    from app.services.mail_rules import auto_trash_reason

    assert auto_trash_reason(sender, subject) == expected
