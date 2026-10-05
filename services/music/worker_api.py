"""Authenticated loopback API; intentionally independent of the web app/NAS."""
import argparse
import logging
from logging.handlers import RotatingFileHandler
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID

import anyio
from fastapi import FastAPI, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware
import uvicorn

from api_common import ApiBoundary, GenerateRequest
from job_store import JobError
from worker import MusicWorker
from worker_auth import worker_token

DEFAULT_DIRECTORY = Path(__file__).resolve().parents[2] / ".music-runtime" / "worker"


def create_app(worker: MusicWorker, token: str) -> FastAPI:
    if len(token) < 32:
        raise ValueError("API credential must have at least 32 characters")

    @asynccontextmanager
    async def lifespan(app):
        worker.start()
        try:
            yield
        finally:
            await anyio.to_thread.run_sync(worker.close)

    app = FastAPI(title="Voice Grok Music Worker", version="1.0.0", lifespan=lifespan,
                  docs_url=None, redoc_url=None)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"])
    app.add_middleware(ApiBoundary, token=token)

    @app.exception_handler(JobError)
    async def job_error(request, error):
        return JSONResponse({"error": error.code}, error.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        return JSONResponse({"error": "INVALID_REQUEST", "fields": [
            {"location": list(item["loc"]), "type": item["type"]} for item in error.errors()]}, 422)

    def public_job(job):
        # Full tracebacks remain in the local ledger instead of ordinary API responses.
        result = dict(job)
        if result.get("error"):
            result["error"] = {k: v for k, v in result["error"].items() if k != "traceback"}
        result["downloads"] = {kind: f"/v1/jobs/{job['id']}/audio/{kind}" for kind in job["artifacts"]}
        return result

    @app.get("/health")
    def health(response: Response):
        result = worker.health()
        if result.get("error"):
            result["error"] = {k: v for k, v in result["error"].items() if k != "traceback"}
        response.status_code = 200 if result["acceptingJobs"] else 503
        return result

    @app.post("/generate", include_in_schema=False)
    @app.post("/v1/jobs")
    def generate(body: GenerateRequest, response: Response):
        job, created = worker.submit(body.model_dump())
        response.status_code = 202 if created else 200
        response.headers["Location"] = f"/v1/jobs/{job['id']}"
        return {"created": created, "job": public_job(job)}

    @app.get("/jobs", include_in_schema=False)
    @app.get("/v1/jobs")
    def jobs(limit: Annotated[int, Query(ge=1, le=100)] = 20,
             offset: Annotated[int, Query(ge=0)] = 0):
        return {"jobs": [public_job(job) for job in worker.store.list(limit, offset)]}

    @app.get("/status/{job_id}", include_in_schema=False)
    @app.get("/v1/jobs/{job_id}")
    def get_job(job_id: UUID):
        return public_job(worker.store.get(str(job_id)))

    @app.post("/cancel/{job_id}", include_in_schema=False)
    @app.post("/v1/jobs/{job_id}/cancel")
    def cancel(job_id: UUID, response: Response):
        job = worker.store.cancel(str(job_id))
        response.status_code = 202 if job["state"] == "CANCEL_REQUESTED" else 200
        return public_job(job)

    @app.api_route("/v1/jobs/{job_id}/audio/{format}", methods=["GET", "HEAD"])
    def download(job_id: UUID, format: Literal["wav", "mp3"]):
        job = worker.store.get(str(job_id))
        metadata = job["artifacts"].get(format)
        if not metadata:
            raise JobError("AUDIO_NOT_READY", 409)
        filename = "original.wav" if format == "wav" else "preview.mp3"
        path = worker.directory / "audio" / str(job_id) / filename
        if not path.is_file() or not path.resolve().is_relative_to(worker.directory):
            raise JobError("AUDIO_FILE_MISSING", 404)
        return FileResponse(path, media_type="audio/wav" if format == "wav" else "audio/mpeg",
                            filename=f"{job_id}.{format}", headers={"ETag": f'"{metadata["sha256"]}"',
                            "X-Audio-SHA256": metadata["sha256"]})

    return app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8093)
    parser.add_argument("--data", type=Path, default=DEFAULT_DIRECTORY)
    args = parser.parse_args()
    token = worker_token(create=True)
    args.data.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(args.data / "worker.log", maxBytes=2 * 2**20, backupCount=3, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger = logging.getLogger("music.worker")
    logger.setLevel(logging.INFO)
    logger.addHandler(handler)
    logger.propagate = False
    app = create_app(MusicWorker(args.data), token)
    uvicorn.run(app, host="127.0.0.1", port=args.port, workers=1, access_log=False,
                proxy_headers=False, limit_concurrency=32, timeout_keep_alive=5)


if __name__ == "__main__":
    main()
