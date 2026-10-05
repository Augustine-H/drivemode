"""Shared wire contract and authenticated HTTP boundary for music services."""
import secrets
import re
from typing import Literal
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

class GenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    requestId: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_.:-]+$")
    prompt: str = Field(min_length=1, max_length=2000)
    duration: int = Field(ge=1, le=120)
    seed: int = Field(default=1042, ge=0, le=2147483647)
    bitrate: Literal[128, 192, 256, 320] = 320

    @field_validator("prompt")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Prompt cannot be blank")
        return value.strip()


class ApiBoundary:
    def __init__(self, app, token: str, worker_token: str | None = None, allowed_origins=()):
        self.app, self.token = app, token.encode("ascii")
        self.worker_token = worker_token.encode("ascii") if worker_token else None
        self.allowed_origins = {origin.encode("ascii") for origin in allowed_origins}

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = scope["headers"]
        origins = [value for name, value in headers if name == b"origin"]
        origin = origins[0] if len(origins) == 1 else None
        browser_allowed = bool(origin and origin in self.allowed_origins and
                               (scope["path"] == "/health" or scope["path"].startswith("/v1/jobs")))
        cors = [(b"access-control-allow-origin", origin), (b"vary", b"Origin"),
                (b"access-control-expose-headers", b"Content-Length,Content-Range,ETag,X-Audio-SHA256")] if browser_allowed else []
        if scope["method"] == "OPTIONS":
            requested_method = next((v for k, v in headers if k == b"access-control-request-method"), b"")
            requested_headers = next((v for k, v in headers if k == b"access-control-request-headers"), b"")
            accepted_headers = {b"authorization", b"content-type", b"range"}
            if not browser_allowed or requested_method not in {b"GET", b"POST", b"HEAD"} or any(
                h.strip().lower() not in accepted_headers for h in requested_headers.split(b",") if h.strip()
            ):
                return await JSONResponse({"error": "BROWSER_ORIGIN_NOT_ALLOWED"}, 403)(scope, receive, send)
            async def preflight_send(event):
                if event["type"] == "http.response.start":
                    event["headers"] += cors + [
                        (b"access-control-allow-methods", b"GET,POST,HEAD"),
                        (b"access-control-allow-headers", b"Authorization,Content-Type,Range"),
                        (b"access-control-max-age", b"300")]
                await send(event)
            return await JSONResponse(None, 200)(scope, receive, preflight_send)
        if origins and not browser_allowed:
            return await JSONResponse({"error": "BROWSER_ORIGIN_NOT_ALLOWED"}, 403)(scope, receive, send)
        async def browser_send(event):
            if event["type"] == "http.response.start":
                event["headers"] = list(event["headers"]) + cors
            await response_send(event)
        response_send = send
        send = browser_send
        auth = [value for name, value in headers if name == b"authorization"]
        expected = self.worker_token if self.worker_token and scope["path"].startswith("/internal/") else self.token
        if len(auth) != 1 or not secrets.compare_digest(auth[0], b"Bearer " + expected):
            return await JSONResponse({"error": "UNAUTHORIZED"}, 401,
                                      headers={"WWW-Authenticate": "Bearer"})(scope, receive, send)
        if self.worker_token and scope["method"] == "PUT" and re.fullmatch(
            r"/internal/jobs/[a-f0-9-]{36}/audio/(wav|mp3)", scope["path"]
        ):
            # Authenticated upload handler streams with a metadata-bound byte limit.
            return await self.app(scope, receive, send)
        body = bytearray()
        while True:
            event = await receive()
            if event["type"] == "http.disconnect":
                return
            body.extend(event.get("body", b""))
            if len(body) > 16384:
                return await JSONResponse({"error": "BODY_TOO_LARGE"}, 413)(scope, receive, send)
            if not event.get("more_body", False):
                break
        consumed = False

        async def replay():
            nonlocal consumed
            if not consumed:
                consumed = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        async def safe_send(event):
            if event["type"] == "http.response.start":
                event["headers"] = list(event["headers"]) + [
                    (b"cache-control", b"no-store"), (b"x-content-type-options", b"nosniff")]
            await send(event)

        await self.app(scope, replay, safe_send)
