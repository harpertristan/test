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
