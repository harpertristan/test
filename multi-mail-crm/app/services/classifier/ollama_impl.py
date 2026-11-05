import json
import httpx
from app.core.config import settings
from app.services.classifier.base import RetryingClassifier, SYSTEM


class OllamaClassifier(RetryingClassifier):
    async def call(self, subject, body):
        cfg = settings()
        async with httpx.AsyncClient(timeout=90) as http:
            response = await http.post(
                cfg.ollama_base_url.rstrip("/") + "/api/chat",
                json={
                    "model": cfg.ollama_model,
                    "stream": False,
                    "format": "json",
                    "options": {"temperature": 0, "num_predict": 250},
                    "messages": [
                        {"role": "system", "content": SYSTEM},
                        {
                            "role": "user",
                            "content": json.dumps(
                                {"subject": subject, "body": body}, ensure_ascii=False
                            ),
                        },
                    ],
                },
            )
            response.raise_for_status()
            return response.json()["message"]["content"]
