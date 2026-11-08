"""OpenAI chat-only gateway. The agent connects over a private Unix socket."""

import http.server
import json
import os
from pathlib import Path
import socketserver
import sqlite3
from datetime import datetime, timezone
import threading
import time
import urllib.error
import urllib.request

UPSTREAM = "https://api.openai.com/v1/chat/completions"
MAX_BODY = 1024 * 1024
MAX_REPLY = 16 * 1024 * 1024
ALLOWED_FIELDS = {
    "model",
    "messages",
    "tools",
    "tool_choice",
    "parallel_tool_calls",
    "temperature",
    "top_p",
    "max_tokens",
    "max_completion_tokens",
    "stream",
    "stream_options",
    "response_format",
    "seed",
    "stop",
    "frequency_penalty",
    "presence_penalty",
    "store",
    "reasoning_effort",
    "prompt_cache_key",
    "prompt_cache_retention",
    "options",
}


def validate(payload, models):
    if not isinstance(payload, dict) or set(payload) - ALLOWED_FIELDS:
        raise ValueError("Unsupported fields")
    if payload.get("model") not in models:
        raise ValueError("Model not allowed")
    messages = payload.get("messages")
    if not isinstance(messages, list) or not 1 <= len(messages) <= 300:
        raise ValueError("Invalid messages")
    for message in messages:
        if not isinstance(message, dict) or message.get("role") not in {
            "system",
            "developer",
            "user",
            "assistant",
            "tool",
            "function",
        }:
            raise ValueError("Invalid message")
        content = message.get("content")
        if content is not None and not isinstance(content, str):
            if not isinstance(content, list) or any(
                not isinstance(part, dict)
                or set(part) - {"type", "text"}
                or part.get("type") != "text"
                or not isinstance(part.get("text"), str)
                for part in content
            ):
                raise ValueError("Only text content is allowed")
    for tool in payload.get("tools", []):
        if not isinstance(tool, dict) or tool.get("type") != "function":
            raise ValueError("Only client-side function tools are allowed")
    for key in ("max_tokens", "max_completion_tokens"):
        if key in payload and (
            type(payload[key]) is not int or not 1 <= payload[key] <= 65536
        ):
            raise ValueError("Output token limit exceeded")
    if payload.get("store") not in (None, False):
        raise ValueError("Stored completions are disabled")
    effort = payload.get("reasoning_effort")
    if effort is not None and effort not in (
        "none",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
        "default",
    ):
        raise ValueError("Invalid reasoning option")
    options = payload.get("options")
    if options is not None and (
        not isinstance(options, dict)
        or set(options) - {"num_ctx"}
        or type(options.get("num_ctx")) is not int
        or not 1 <= options["num_ctx"] <= 1000000
    ):
        raise ValueError("Unsupported local-model options")
    result = dict(payload)
    # Hermes custom profile emits these local/provider hints. GPT-4o-mini does
    # not accept reasoning_effort or Ollama options. Cache hints are unnecessary.
    for field in (
        "reasoning_effort",
        "options",
        "prompt_cache_key",
        "prompt_cache_retention",
    ):
        result.pop(field, None)
    for field in ("max_tokens", "max_completion_tokens"):
        if field in result:
            result[field] = min(result[field], 8192)
    result["store"] = False
    if not {"max_tokens", "max_completion_tokens"} & result.keys():
        result["max_tokens"] = 4096
    return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Gateway(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True

    def __init__(
        self,
        path,
        key,
        models,
        opener=None,
        quota_path=None,
        daily_requests=0,
        daily_bytes=0,
    ):
        self.key = key
        self.models = models
        self.opener = opener or urllib.request.build_opener(
            urllib.request.ProxyHandler({}), NoRedirect()
        )
        self.active = threading.BoundedSemaphore(2)
        self.lock = threading.Lock()
        self.calls = []
        self.quota_path = quota_path
        self.daily_requests = daily_requests
        self.daily_bytes = daily_bytes
        if quota_path:
            with sqlite3.connect(quota_path) as connection:
                connection.execute(
                    "CREATE TABLE IF NOT EXISTS usage(day TEXT PRIMARY KEY, calls INTEGER NOT NULL, input_bytes INTEGER NOT NULL)"
                )
        super().__init__(path, Handler)

    def allowed(self, input_bytes=0):
        with self.lock:
            now = time.monotonic()
            self.calls = [stamp for stamp in self.calls if now - stamp < 60]
            if len(self.calls) >= 20:
                return False
            if self.quota_path:
                day = datetime.now(timezone.utc).date().isoformat()
                with sqlite3.connect(self.quota_path) as connection:
                    connection.execute("BEGIN IMMEDIATE")
                    row = connection.execute(
                        "SELECT calls,input_bytes FROM usage WHERE day=?", (day,)
                    ).fetchone() or (0, 0)
                    if (self.daily_requests > 0 and row[0] >= self.daily_requests) or (
                        self.daily_bytes > 0 and row[1] + input_bytes > self.daily_bytes
                    ):
                        return False
                    connection.execute(
                        "INSERT INTO usage(day,calls,input_bytes) VALUES(?,?,?) ON CONFLICT(day) DO UPDATE SET calls=excluded.calls,input_bytes=excluded.input_bytes",
                        (day, row[0] + 1, row[1] + input_bytes),
                    )
            self.calls.append(now)
            return True

    def handle_error(self, request, client_address):
        print("model_gateway: internal request error", flush=True)


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "WorkspaceModelGateway"

    def setup(self):
        super().setup()
        self.connection.settimeout(90)

    def log_message(self, *args):
        pass  # Never log prompts, headers or keys.

    def reply(self, status, body):
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path == "/health":
            return self.reply(
                200, {"status": "ready", "scope": "openai-text-chat-only"}
            )
        if self.path == "/v1/models":
            return self.reply(
                200,
                {
                    "object": "list",
                    "data": [
                        {"id": model, "object": "model", "owned_by": "allowed"}
                        for model in self.server.models
                    ],
                },
            )
        self.reply(403, {"error": "Endpoint not allowed"})

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            # Drain small bodies before closing the Unix HTTP connection; otherwise
            # a fast rejection can race the client's send and hide the 403.
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if 0 < size <= 65536 and not self.headers.get("Transfer-Encoding"):
                    self.rfile.read(size)
            except (ValueError, OSError):
                pass
            return self.reply(403, {"error": "Endpoint not allowed"})
        try:
            if self.headers.get("Transfer-Encoding"):
                raise ValueError("Chunked requests not supported")
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= MAX_BODY:
                raise ValueError("Invalid request size")
            payload = validate(json.loads(self.rfile.read(size)), self.server.models)
        except json.JSONDecodeError:
            return self.reply(
                400,
                {"error": "Request rejected by model policy", "reason": "Invalid JSON"},
            )
        except ValueError as error:
            # Every validator message is fixed text, never a payload/key value.
            reason = (
                str(error)
                if str(error)
                in {
                    "Unsupported fields",
                    "Model not allowed",
                    "Invalid messages",
                    "Invalid message",
                    "Only text content is allowed",
                    "Only client-side function tools are allowed",
                    "Output token limit exceeded",
                    "Stored completions are disabled",
                    "Invalid reasoning option",
                    "Unsupported local-model options",
                    "Invalid request size",
                    "Chunked requests not supported",
                }
                else "Invalid request format"
            )
            return self.reply(
                400, {"error": "Request rejected by model policy", "reason": reason}
            )
        except TypeError:
            return self.reply(
                400,
                {
                    "error": "Request rejected by model policy",
                    "reason": "Invalid request format",
                },
            )
        if not self.server.allowed(size) or not self.server.active.acquire(
            blocking=False
        ):
            return self.reply(429, {"error": "Model gateway rate/concurrency limit"})
        started = False
        try:
            request = urllib.request.Request(
                UPSTREAM,
                data=json.dumps(payload).encode(),
                headers={
                    "Authorization": "Bearer " + self.server.key,
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            with self.server.opener.open(request, timeout=90) as response:
                self.send_response(response.status)
                self.send_header(
                    "Content-Type",
                    "text/event-stream"
                    if payload.get("stream")
                    else "application/json",
                )
                self.send_header("Connection", "close")
                self.end_headers()
                started = True
                total = 0
                while chunk := response.read1(65536):
                    total += len(chunk)
                    if total > MAX_REPLY:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
        except urllib.error.HTTPError as error:
            if not started:
                self.reply(
                    error.code,
                    {
                        "error": "OpenAI rejected the request; check model access, key and account limits"
                    },
                )
        except Exception:
            if not started:
                self.reply(502, {"error": "OpenAI connection failed"})
        finally:
            self.server.active.release()


def main():
    path = Path(os.environ.get("BRIDGE_SOCKET", "/run/model-bridge/openai.sock"))
    key = (
        Path(os.environ.get("OPENAI_KEY_FILE", "/run/secrets/openai.key"))
        .read_text()
        .strip()
    )
    if not key.startswith("sk-"):
        raise SystemExit("Model gateway key file is missing or invalid")
    models = tuple(os.environ.get("ALLOWED_MODELS", "gpt-4o-mini").split(","))
    if path.exists():
        path.unlink()
    with Gateway(
        str(path),
        key,
        models,
        quota_path="/state/model-usage.sqlite3",
        daily_requests=int(os.environ.get("DAILY_REQUEST_LIMIT", "0")),
        daily_bytes=int(os.environ.get("DAILY_INPUT_BYTE_LIMIT", "0")),
    ) as server:
        os.chmod(path, 0o660)
        print("model_gateway: ready; only text chat completions allowed", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
