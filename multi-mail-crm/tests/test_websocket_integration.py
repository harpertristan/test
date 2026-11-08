import json
import os
import time
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from redis import Redis
from starlette.websockets import WebSocketDisconnect

from app.core.config import settings
from app.main import app

pytestmark = pytest.mark.skipif(
    os.environ.get("TEST_INTEGRATION") != "1",
    reason="Dedicated PostgreSQL/Redis integration test",
)


def test_open_workspace_origin_scope_and_redis_fanout(admin_user):
    ws_base = (
        settings().public_url.replace("https://", "wss://").replace("http://", "ws://")
    )
    with TestClient(app, base_url=settings().public_url) as client:
        result = client.get("/workspace")
        assert result.status_code == 200 and "set-cookie" not in result.headers
        uid = result.json()["id"]
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(
                ws_base + "/ws/notifications/" + str(uuid4()),
                headers={"Origin": settings().public_url},
            ):
                pass
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(
                ws_base + "/ws/notifications/" + uid,
                headers={"Origin": "https://attacker.example"},
            ):
                pass
        with client.websocket_connect(
            ws_base + "/ws/notifications/" + uid,
            headers={"Origin": settings().public_url},
        ) as socket:
            assert socket.receive_json()["type"] == "connected"
            with Redis.from_url(settings().redis_url, decode_responses=True) as redis:
                for _ in range(100):
                    if redis.pubsub_numsub("crm:events")[0][1]:
                        break
                    time.sleep(0.02)
                redis.publish(
                    "crm:events",
                    json.dumps(
                        {
                            "type": "notification",
                            "user_id": uid,
                            "message_id": "test-message",
                        }
                    ),
                )
            assert socket.receive_json()["message_id"] == "test-message"
            socket.send_text("ping")
            assert socket.receive_json()["type"] == "pong"
