"""CPU-only NAS queue/archive. Windows connects outbound; no GPU access here."""
import argparse
import asyncio
from contextlib import asynccontextmanager
import hashlib
import os
from pathlib import Path
import re
import shutil
from typing import Annotated, Literal
from uuid import UUID, uuid4

import anyio
from fastapi import FastAPI, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from filelock import FileLock
from pydantic import BaseModel, ConfigDict, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware
import uvicorn

from api_common import ApiBoundary, GenerateRequest
from job_store import JobError
from nas_store import NasStore
from provider import file_hash


class Poll(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    ready: bool
    sessionId: str = Field(min_length=1, max_length=100)


class Artifact(BaseModel):
    model_config = ConfigDict(extra="allow", strict=True)
    bytes: int = Field(ge=1, le=64 * 2**20)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")


class WorkerResult(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    localJobId: str = Field(pattern=r"^[a-f0-9-]{36}$")
    workerState: Literal["QUEUED", "LOADING", "GENERATING", "VERIFYING_WAV", "ENCODING", "CANCEL_REQUESTED", "COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"]
    artifacts: dict[Literal["wav", "mp3"], Artifact] = Field(default_factory=dict)
    model: dict | None = None
    metrics: dict | None = None
    error: dict | None = None
    recognition: dict | None = None
    progress: dict | None = None


def read_secret(path: str) -> str:
    value = Path(path).read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{48,128}", value):
        raise ValueError("INVALID_SERVICE_SECRET")
    return value


def create_nas_app(directory: Path, client_token: str, bridge_token: str,
                   allowed_hosts=None, min_free_bytes=2 * 2**30, allowed_origins=()):
    if client_token == bridge_token or min(len(client_token), len(bridge_token)) < 48:
        raise ValueError("SEPARATE_STRONG_SERVICE_KEYS_REQUIRED")
    directory = directory.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    lock = FileLock(str(directory / "nas-service.lock"), thread_local=False)
    upload_lock = asyncio.Lock()

    @asynccontextmanager
    async def lifespan(app):
        lock.acquire(timeout=0)
        try:
            app.state.store = NasStore(directory)
            # NAS restart keeps assignments; only the same bridge reconciles them.
            yield
        finally:
            lock.release()

    app = FastAPI(title="Voice Grok NAS Music", version="1.0.0", lifespan=lifespan,
                  docs_url=None, redoc_url=None)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts or ["127.0.0.1", "localhost", "testserver"])
    app.add_middleware(ApiBoundary, token=client_token, worker_token=bridge_token, allowed_origins=allowed_origins)

    @app.exception_handler(JobError)
    async def job_error(request, error):
        return JSONResponse({"error": error.code}, error.status)

    @app.exception_handler(RequestValidationError)
    async def invalid(request, error):
        return JSONResponse({"error": "INVALID_REQUEST", "fields": [
            {"location": list(item["loc"]), "type": item["type"]} for item in error.errors()]}, 422)

    def public(job):
        result = dict(job)
        result['request'] = {k: v for k, v in job['request'].items() if k != 'audioBase64'}
        result["downloads"] = {kind: f"/v1/jobs/{job['id']}/audio/{kind}" for kind in job["artifacts"]}
        return result

    @app.get("/health")
    def health():
        return app.state.store.health()

    @app.post("/v1/jobs")
    def enqueue(body: GenerateRequest, response: Response):
        if shutil.disk_usage(directory).free < min_free_bytes:
            raise JobError("INSUFFICIENT_DISK_SPACE", 507)
        job, created = app.state.store.enqueue(body.model_dump(exclude_none=True))
        response.status_code = 202 if created else 200
        return {"created": created, "job": public(job)}

    @app.get("/v1/jobs")
    def jobs(limit: Annotated[int, Query(ge=1, le=100)] = 20,
             offset: Annotated[int, Query(ge=0)] = 0):
        return {"jobs": [public(j) for j in app.state.store.list(limit, offset)]}

    @app.get("/v1/jobs/{job_id}")
    def get_job(job_id: UUID):
        return public(app.state.store.get(str(job_id)))

    @app.post("/v1/jobs/{job_id}/cancel")
    def cancel(job_id: UUID, response: Response):
        job = app.state.store.cancel(str(job_id))
        response.status_code = 202 if job["state"] == "CANCEL_REQUESTED" else 200
        return public(job)

    @app.api_route("/v1/jobs/{job_id}/audio/{kind}", methods=["GET", "HEAD"])
    def download(job_id: UUID, kind: Literal["wav", "mp3"]):
        job = app.state.store.get(str(job_id))
        artifact = job["artifacts"].get(kind)
        if not artifact:
            raise JobError("AUDIO_NOT_ARCHIVED", 409)
        path = app.state.store.audio_path(str(job_id), kind)
        if not path.is_file() or not path.resolve().is_relative_to(directory):
            raise JobError("ARCHIVE_FILE_MISSING", 404)
        return FileResponse(path, media_type="audio/wav" if kind == "wav" else "audio/mpeg",
                            filename=f"{job_id}.{kind}", headers={"ETag": f'"{artifact["sha256"]}"',
                            "X-Audio-SHA256": artifact["sha256"], "Cache-Control": "no-store"})

    @app.post("/internal/worker/poll")
    def poll(body: Poll):
        job = app.state.store.poll(body.ready, body.sessionId)
        return {"job": job, "pollAfterSeconds": 3}

    @app.post("/internal/jobs/{job_id}/status")
    def report(job_id: UUID, body: WorkerResult):
        return public(app.state.store.report(str(job_id), body.model_dump()))

    @app.put("/internal/jobs/{job_id}/audio/{kind}")
    async def upload(job_id: UUID, kind: Literal["wav", "mp3"], request: Request):
        async with upload_lock:
            store = app.state.store
            expected = store.expected_artifact(str(job_id), kind)
            final = store.audio_path(str(job_id), kind)
            if shutil.disk_usage(directory).free < min_free_bytes + expected["bytes"]:
                raise JobError("INSUFFICIENT_DISK_SPACE", 507)
            final.parent.mkdir(parents=True, exist_ok=True)
            if final.exists():
                actual_hash = await anyio.to_thread.run_sync(file_hash, final)
                if final.stat().st_size != expected["bytes"] or actual_hash != expected["sha256"]:
                    raise JobError("ARCHIVE_FILE_CONFLICT", 409)
                store.record_artifact(str(job_id), kind, expected)
                return {"stored": True, "reused": True, "sha256": actual_hash}
            temporary = final.with_name(final.name + "." + str(uuid4()) + ".partial")
            received = 0
            digest = hashlib.sha256()
            try:
                with temporary.open("xb") as handle:
                    async for chunk in request.stream():
                        received += len(chunk)
                        if received > expected["bytes"]:
                            raise JobError("UPLOAD_TOO_LARGE", 413)
                        digest.update(chunk)
                        await anyio.to_thread.run_sync(handle.write, chunk)
                    handle.flush()
                    os.fsync(handle.fileno())
                if received != expected["bytes"] or digest.hexdigest() != expected["sha256"]:
                    raise JobError("UPLOAD_INTEGRITY_MISMATCH", 422)
                temporary.replace(final)
                store.record_artifact(str(job_id), kind, expected)
                return {"stored": True, "reused": False, "sha256": digest.hexdigest()}
            finally:
                # Only this request's incomplete temporary file can be removed.
                temporary.unlink(missing_ok=True)

    @app.post("/internal/jobs/{job_id}/complete")
    def complete(job_id: UUID):
        return public(app.state.store.finalize(str(job_id)))

    return app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8094)
    args = parser.parse_args()
    app = create_nas_app(Path(os.environ.get("MUSIC_DATA_ROOT", "/data")),
                         read_secret(os.environ["MUSIC_CLIENT_TOKEN_FILE"]),
                         read_secret(os.environ["MUSIC_BRIDGE_TOKEN_FILE"]),
                         allowed_hosts=os.environ.get("MUSIC_ALLOWED_HOSTS", "127.0.0.1,localhost").split(","),
                         allowed_origins=[v.strip() for v in os.environ.get("MUSIC_ALLOWED_ORIGINS", "").split(",") if v.strip()])
    uvicorn.run(app, host=args.host, port=args.port, workers=1, access_log=False,
                proxy_headers=False, limit_concurrency=32)


if __name__ == "__main__":
    main()
