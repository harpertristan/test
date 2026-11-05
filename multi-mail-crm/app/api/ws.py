import asyncio
from uuid import UUID

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from app.core.config import settings
from app.core.db import Session
from app.core.security import workspace_user
from app.services.notify.ws_manager import manager

router = APIRouter()


@router.websocket("/ws/notifications/{user_id}")
async def notifications(socket: WebSocket, user_id: UUID):
    if socket.headers.get("origin") != settings().public_url:
        await socket.close(code=4403)
        return
    try:
        async with Session() as session:
            user = await workspace_user(session)
            await session.commit()
        if user.id != user_id:
            raise HTTPException(403)
    except HTTPException:
        await socket.close(code=4401)
        return
    await socket.accept()
    manager.add(user.id, socket)
    try:
        await socket.send_json({"type": "connected"})
        while True:
            try:
                value = await asyncio.wait_for(socket.receive_text(), timeout=25)
                if value == "ping":
                    await socket.send_json({"type": "pong"})
            except asyncio.TimeoutError:
                await socket.send_json({"type": "heartbeat"})
    except (WebSocketDisconnect, RuntimeError):
        pass
    except HTTPException:
        await socket.close(code=4401)
    finally:
        manager.remove(user.id, socket)
