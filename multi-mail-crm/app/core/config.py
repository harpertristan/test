from functools import lru_cache
from urllib.parse import urlparse

from cryptography.fernet import Fernet
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", extra="ignore", case_sensitive=False
    )
    database_url: str
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/1"
    jwt_secret: str
    fernet_key: str
    public_url: str = "http://localhost:8080"
    app_base_path: str = ""

    @property
    def app_url(self) -> str:
        return self.public_url + self.app_base_path.rstrip("/")

    @field_validator("app_base_path")
    @classmethod
    def valid_base_path(cls, value):
        if value not in ("", "/mail-crm", "/mail-crm/"):
            raise ValueError("APP_BASE_PATH must be empty or /mail-crm")
        return value.rstrip("/")

    zoho_client_id: str = ""
    zoho_client_secret: str = ""
    zoho_organization_id: str = ""
    gmail_client_id: str = ""
    gmail_client_secret: str = ""
    gmail_pubsub_topic: str = ""
    gmail_pubsub_audience: str = ""
    gmail_push_service_account: str = ""
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    classifier_backend: str = "openai"
    ollama_base_url: str = "http://host.docker.internal:11434"
    ollama_model: str = "qwen2.5:7b"
    telegram_bot_token: str = ""
    telegram_bot_username: str = ""
    imap_max_connections: int = 8
    sync_interval_seconds: int = 120
    zoho_requests_per_minute: int = 30
    llm_requests_per_minute: int = 60
    sync_batch_size: int = 25
    initial_sync_days: int = 30
    max_message_bytes: int = 10 * 1024 * 1024
    log_level: str = "INFO"

    @field_validator("jwt_secret")
    @classmethod
    def strong_secret(cls, value: str) -> str:
        if len(value) < 32 or value.startswith("replace-"):
            raise ValueError("JWT_SECRET must contain at least 32 random characters")
        return value

    @field_validator("fernet_key")
    @classmethod
    def valid_fernet(cls, value: str) -> str:
        Fernet(value.encode())
        return value

    @field_validator("public_url")
    @classmethod
    def valid_url(cls, value: str) -> str:
        parsed = urlparse(value)
        if (
            parsed.scheme not in ("http", "https")
            or not parsed.netloc
            or parsed.path not in ("", "/")
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("PUBLIC_URL must be an absolute HTTP(S) origin")
        return value.rstrip("/")

    @field_validator(
        "imap_max_connections", "sync_batch_size", "llm_requests_per_minute"
    )
    @classmethod
    def positive(cls, value: int) -> int:
        if value < 1:
            raise ValueError("must be positive")
        return value


@lru_cache
def settings() -> Settings:
    return Settings()
