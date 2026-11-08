import time

import httpx

from app.core.config import settings
from app.core.security import decrypt_tokens, encrypt_tokens
from app.services.mail.base import MailProvider


class OAuthProvider(MailProvider):
    token_url = ""

    def __init__(self, account, client=None):
        self.account = account
        self.tokens = decrypt_tokens(account.oauth_token)
        self.client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(30, connect=10), follow_redirects=False
        )
        self.owns_client = client is None

    async def access(self, force=False):
        if not self.tokens.get("refresh_token"):
            raise ValueError("OAuth не подключён: нужна авторизация администратора")
        if force or float(self.tokens.get("expires_at", 0)) < time.time() + 120:
            cfg = settings()
            zoho = self.account.provider == "zoho_eu"
            response = await self.client.post(
                self.token_url,
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": self.tokens["refresh_token"],
                    "client_id": cfg.zoho_client_id if zoho else cfg.gmail_client_id,
                    "client_secret": cfg.zoho_client_secret
                    if zoho
                    else cfg.gmail_client_secret,
                },
            )
            response.raise_for_status()
            body = response.json()
            if not body.get("access_token"):
                raise ValueError("OAuth refresh rejected")
            self.tokens = {
                **self.tokens,
                **body,
                "expires_at": time.time() + int(body.get("expires_in", 3600)),
            }
            self.account.oauth_token = encrypt_tokens(self.tokens)
        return self.tokens["access_token"]

    async def request(self, method, url, **kwargs):
        for attempt in range(2):
            token = await self.access(force=bool(attempt))
            await self.before_request()
            headers = {**kwargs.pop("headers", {}), **self.auth_header(token)}
            response = await self.client.request(method, url, headers=headers, **kwargs)
            if response.status_code == 401 and attempt == 0:
                continue
            response.raise_for_status()
            result = response.json() if response.content else {}
            self.check_response(result)
            return result
        raise RuntimeError("OAuth request failed")

    def auth_header(self, token):
        return {"Authorization": "Bearer " + token}

    async def before_request(self):
        pass

    def check_response(self, result):
        pass

    async def close(self):
        if self.owns_client:
            await self.client.aclose()
