import base64
import hashlib
import hmac
import json
import time
from uuid import UUID

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import db
from app.core.security import admin
from app.models import MailAccount, User
from app.services.events import event

router = APIRouter(tags=["webhooks"])
_jwks = {"until": 0, "keys": []}


def zoho_token(account_id):
    return hmac.new(
        settings().jwt_secret.encode(),
        ("zoho-webhook:" + str(account_id)).encode(),
        hashlib.sha256,
    ).hexdigest()


@router.get("/accounts/{account_id}/zoho-webhook")
async def webhook_config(
    account_id: UUID, _: User = Depends(admin), session: AsyncSession = Depends(db)
):
    account = await session.get(MailAccount, account_id)
    if not account or account.provider != "zoho_eu":
        raise HTTPException(404)
    return {
        "url": settings().app_url + "/api/webhooks/zoho/" + str(account_id),
        "header_name": "X-CRM-Webhook-Token",
        "header_value": zoho_token(account_id),
    }


@router.post("/webhooks/zoho/{account_id}", status_code=202)
async def zoho(account_id: UUID, request: Request, session: AsyncSession = Depends(db)):
    if not hmac.compare_digest(
        request.headers.get("X-CRM-Webhook-Token", ""), zoho_token(account_id)
    ):
        raise HTTPException(401, "Invalid webhook signature")
    account = await session.get(MailAccount, account_id)
    if account and account.is_active and account.provider == "zoho_eu":
        event(session, "sync.request", {"account_id": str(account_id)})
        await session.commit()
    return {"status": "accepted"}


async def verify_google(token):
    cfg = settings()
    if not cfg.gmail_pubsub_audience or not cfg.gmail_push_service_account:
        raise HTTPException(503, "Gmail push не настроен")
    try:
        header = jwt.get_unverified_header(token)
        if _jwks["until"] < time.time():
            async with httpx.AsyncClient(timeout=10) as http:
                response = await http.get("https://www.googleapis.com/oauth2/v3/certs")
                response.raise_for_status()
                _jwks.update(until=time.time() + 1800, keys=response.json()["keys"])
        key = next(k for k in _jwks["keys"] if k.get("kid") == header.get("kid"))
        claims = jwt.decode(
            token,
            jwt.PyJWK.from_dict(key).key,
            algorithms=["RS256"],
            audience=cfg.gmail_pubsub_audience,
            options={"require": ["exp", "iat", "aud", "iss", "email"]},
        )
        if (
            claims["iss"] not in ("accounts.google.com", "https://accounts.google.com")
            or claims["email"] != cfg.gmail_push_service_account
            or not claims.get("email_verified")
        ):
            raise ValueError()
    except (jwt.InvalidTokenError, StopIteration, ValueError, KeyError):
        raise HTTPException(401, "Invalid Pub/Sub identity") from None


@router.post("/webhooks/gmail", status_code=202)
async def gmail(request: Request, session: AsyncSession = Depends(db)):
    authorization = request.headers.get("authorization", "")
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing OIDC token")
    await verify_google(authorization[7:])
    try:
        body = await request.json()
        data = json.loads(base64.b64decode(body["message"]["data"], validate=True))
        address = str(data["emailAddress"]).lower()
    except (ValueError, KeyError, TypeError):
        raise HTTPException(400, "Invalid Pub/Sub payload") from None
    account = await session.scalar(
        select(MailAccount).where(
            MailAccount.email == address,
            MailAccount.provider == "gmail",
            MailAccount.is_active.is_(True),
        )
    )
    if account:
        event(session, "sync.request", {"account_id": str(account.id)})
        await session.commit()
    return {"status": "accepted"}
