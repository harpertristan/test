import json
from openai import AsyncOpenAI
from app.core.config import settings
from app.services.classifier.base import RetryingClassifier, SYSTEM


class OpenAIClassifier(RetryingClassifier):
    def __init__(self, redis_client, client=None, **kwargs):
        super().__init__(redis_client, **kwargs)
        self.client = client

    async def call(self, subject, body):
        cfg = settings()
        if not cfg.openai_api_key and self.client is None:
            raise ValueError("OPENAI_API_KEY missing")
        client = self.client or AsyncOpenAI(
            api_key=cfg.openai_api_key, max_retries=0, timeout=30
        )
        try:
            result = await client.chat.completions.create(
                model=cfg.openai_model,
                response_format={"type": "json_object"},
                temperature=0,
                max_tokens=250,
                messages=[
                    {"role": "system", "content": SYSTEM},
                    {
                        "role": "user",
                        "content": json.dumps(
                            {"subject": subject, "body": body}, ensure_ascii=False
                        ),
                    },
                ],
            )
            return result.choices[0].message.content or ""
        finally:
            if self.client is None:
                await client.close()
