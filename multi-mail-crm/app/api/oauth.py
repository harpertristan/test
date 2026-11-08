import json
import secrets
import time
from urllib.parse import urlencode
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import db
from app.core.redis import Lease, redis
from app.core.security import admin, digest, encrypt_tokens
from app.models import MailAccount, User
from app.services.events import event

router = APIRouter(tags=["oauth"])


@router.post("/accounts/{account_id}/oauth/start")
async def start(
    account_id: UUID, user: User = Depends(admin), session: AsyncSession = Depends(db)
):
    account = await session.get(MailAccount, account_id)
    if not account or account.provider not in ("gmail", "zoho_eu"):
        raise HTTPException(404, "OAuth-ящик не найден")
    cfg = settings()
    zoho = account.provider == "zoho_eu"
    client_id = cfg.zoho_client_id if zoho else cfg.gmail_client_id
    secret = cfg.zoho_client_secret if zoho else cfg.gmail_client_secret
    if not client_id or not secret:
        raise HTTPException(503, "Заполните OAuth Client ID/Secret в .env")
    state = secrets.token_urlsafe(32)
    redirect = cfg.app_url + "/api/oauth/callback/" + account.provider
    async with redis() as client:
        await client.set(
            "oauth-state:" + digest(state),
            json.dumps(
                {
                    "account_id": str(account_id),
                    "user_id": str(user.id),
                    "provider": account.provider,
                    "redirect_uri": redirect,
                }
            ),
            ex=600,
        )
    params = {
        "client_id": client_id,
        "redirect_uri": redirect,
        "response_type": "code",
        "state": state,
        "access_type": "offline",
        "prompt": "consent",
        "login_hint": account.email,
    }
    if zoho:
        params["scope"] = (
            "ZohoMail.accounts.READ,ZohoMail.folders.READ,ZohoMail.messages.ALL"
        )
        base = "https://accounts.zoho.eu/oauth/v2/auth"
    else:
        params["scope"] = (
            "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify"
        )
        params["include_granted_scopes"] = "true"
        base = "https://accounts.google.com/o/oauth2/v2/auth"
    return {"url": base + "?" + urlencode(params), "redirect_uri": redirect}


@router.get("/oauth/callback/{provider}")
async def callback(
    provider: str,
    request: Request,
    state: str = "",
    code: str = "",
    error: str = "",
    session: AsyncSession = Depends(db),
):
    if provider not in ("gmail", "zoho_eu"):
        raise HTTPException(404)
    async with redis() as client:
        value = await client.getdel("oauth-state:" + digest(state))
        if not value:
            raise HTTPException(400, "OAuth state истёк или уже использован")
        flow = json.loads(value)
        if flow["provider"] != provider:
            raise HTTPException(400, "OAuth provider mismatch")
        user = await session.get(User, UUID(flow["user_id"]))
        if not user or not user.is_active or user.role != "admin":
            raise HTTPException(403, "Авторизация отменена")
        if error or not code:
            return RedirectResponse(
                settings().app_url + "/?oauth=denied", status_code=303
            )
        async with Lease(client, "account:" + flow["account_id"]):
            account = await session.get(
                MailAccount, UUID(flow["account_id"]), with_for_update=True
            )
            if not account:
                raise HTTPException(404, "Ящик удалён")
            cfg = settings()
            zoho = provider == "zoho_eu"
            async with httpx.AsyncClient(timeout=30) as http:
                response = await http.post(
                    "https://accounts.zoho.eu/oauth/v2/token"
                    if zoho
                    else "https://oauth2.googleapis.com/token",
                    data={
                        "code": code,
                        "grant_type": "authorization_code",
                        "redirect_uri": flow["redirect_uri"],
                        "client_id": cfg.zoho_client_id
                        if zoho
                        else cfg.gmail_client_id,
                        "client_secret": cfg.zoho_client_secret
                        if zoho
                        else cfg.gmail_client_secret,
                    },
                )
                if response.status_code != 200:
                    raise HTTPException(400, "Провайдер отклонил обмен OAuth-кода")
                tokens = response.json()
                if not tokens.get("refresh_token") or not tokens.get("access_token"):
                    raise HTTPException(
                        400,
                        "Нет refresh_token: отзовите прежнее разрешение и подключитесь с consent заново",
                    )
                if not zoho:
                    profile = await http.get(
                        "https://gmail.googleapis.com/gmail/v1/users/me/profile",
                        headers={"Authorization": "Bearer " + tokens["access_token"]},
                    )
                    if (
                        profile.status_code != 200
                        or profile.json().get("emailAddress", "").lower()
                        != account.email.lower()
                    ):
                        raise HTTPException(400, "Авторизована другая Gmail-почта")
                else:
                    from app.core.redis import throttle

                    await throttle(
                        client,
                        "zoho:" + account.organization_id,
                        min(30, cfg.zoho_requests_per_minute),
                    )
                    profile = await http.get(
                        "https://mail.zoho.eu/api/accounts",
                        headers={
                            "Authorization": "Zoho-oauthtoken " + tokens["access_token"]
                        },
                    )
                    if profile.status_code != 200:
                        raise HTTPException(400, "Zoho accounts недоступен")
                    match = None
                    for entry in profile.json().get("data", []):
                        addresses = entry.get("emailAddress", [])
                        if isinstance(addresses, str):
                            addresses = [addresses]
                        if (
                            account.email.lower() in [str(a).lower() for a in addresses]
                            or entry.get("primaryEmailAddress", "").lower()
                            == account.email.lower()
                        ):
                            match = entry
                    if not match:
                        raise HTTPException(400, "Авторизована другая Zoho-почта")
                    account.provider_account_id = str(match["accountId"])
            tokens["expires_at"] = time.time() + int(tokens.get("expires_in", 3600))
            account.oauth_token = encrypt_tokens(tokens)
            account.last_error = None
            account.sync_state = {}
            event(session, "sync.request", {"account_id": str(account.id)})
            event(session, "accounts.changed", {"account_id": str(account.id)})
            await session.commit()
    return RedirectResponse(settings().app_url + "/?oauth=connected", status_code=303)
