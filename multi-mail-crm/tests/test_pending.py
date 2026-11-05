from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import pytest
from app.services.pending import overdue

NOW = datetime(2026, 11, 5, 12, tzinfo=timezone.utc)


@pytest.mark.parametrize(
    "category,age,replied,expected",
    [
        ("ad", 10, False, False),
        ("approve", 10, False, False),
        ("decline", 10, False, False),
        ("add_request", 3, False, True),
        ("other", 3, False, True),
        ("other", 3, True, False),
        ("add_request", 2, False, False),
        ("add_request", 1, False, False),
    ],
)
def test_only_unanswered_questions_older_than_48_hours(
    category, age, replied, expected
):
    message = SimpleNamespace(
        direction="in",
        category=category,
        replied_at=NOW if replied else None,
        needs_reply=True,
        received_at=NOW - timedelta(days=age),
    )
    assert overdue(message, NOW) == expected
