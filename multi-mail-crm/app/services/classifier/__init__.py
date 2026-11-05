from app.core.config import settings
from app.services.classifier.openai_impl import OpenAIClassifier
from app.services.classifier.ollama_impl import OllamaClassifier


def classifier_for(redis_client):
    backend = settings().classifier_backend
    if backend == "openai":
        return OpenAIClassifier(redis_client)
    if backend == "ollama":
        return OllamaClassifier(redis_client)
    raise ValueError("CLASSIFIER_BACKEND must be openai or ollama")
