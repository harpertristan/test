import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from app.services.classifier.base import Classification, RetryingClassifier
from app.services.classifier.openai_impl import OpenAIClassifier


@pytest.mark.parametrize(
    "value",
    [
        {"category": "invented", "confidence": 0.5, "reason": "x"},
        {"category": "other", "confidence": 1.1, "reason": "x"},
        {"category": "other", "confidence": -0.1, "reason": "x"},
        {"category": "ad", "confidence": 0.5, "reason": "x", "action": "send"},
    ],
)
def test_rejects_unstructured_or_invalid(value):
    with pytest.raises(ValidationError):
        Classification.model_validate_json(json.dumps(value))


@pytest.mark.asyncio
async def test_openai_structured_output(monkeypatch):
    monkeypatch.setattr("app.services.classifier.base.throttle", AsyncMock())
    call = AsyncMock(
        return_value=SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content='{"category":"add_request","confidence":0.93,"reason":"Нужна цена"}'
                    )
                )
            ]
        )
    )
    client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=call))
    )
    result = await OpenAIClassifier(None, client=client).classify(
        "КП", "Сколько стоит?"
    )
    assert result.category == "add_request" and result.confidence == 0.93
    kwargs = call.call_args.kwargs
    assert kwargs["response_format"] == {"type": "json_object"}
    assert kwargs["model"] == "gpt-4o-mini"
    assert "untrusted" in kwargs["messages"][0]["content"]


@pytest.mark.asyncio
async def test_three_retries_and_fallback(monkeypatch):
    monkeypatch.setattr("app.services.classifier.base.throttle", AsyncMock())

    class Broken(RetryingClassifier):
        call = AsyncMock(side_effect=TimeoutError("unavailable"))

    sleeper = AsyncMock()
    classifier = Broken(None, sleep=sleeper)
    result = await classifier.classify("x", "y")
    assert classifier.call.await_count == 4
    assert [c.args[0] for c in sleeper.await_args_list] == [1, 2, 4]
    assert result.category == "other" and result.confidence == 0


@pytest.mark.asyncio
async def test_invalid_json_is_retried(monkeypatch):
    monkeypatch.setattr("app.services.classifier.base.throttle", AsyncMock())

    class Sometimes(RetryingClassifier):
        call = AsyncMock(
            side_effect=[
                "not-json",
                '{"category":"approve","confidence":0.9,"reason":"Согласовано"}',
            ]
        )

    result = await Sometimes(None, sleep=AsyncMock()).classify("x", "y")
    assert result.category == "approve"
