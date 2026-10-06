"""Outbound Windows bridge. Retries reconcile stable request IDs, never new jobs."""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
import threading
from urllib.parse import urlsplit
from uuid import UUID

from filelock import FileLock
import httpx

from credentials import _transform
from diagnostics import safe_error
from job_store import TERMINAL, now
from provider import atomic_json
from worker_auth import local_directory, worker_token

ENTROPY = b"VoiceGrok.Music.NasBridge.v1"


def publish_status(path: Path, state: dict) -> bool:
    """The diagnostic snapshot must not terminate durable job synchronization."""
    for attempt in range(3):
        try:
            atomic_json(path, state)
            return True
        except OSError as error:
            if isinstance(error, PermissionError) and attempt < 2:
                threading.Event().wait(0.1 * (attempt + 1))
                continue
            print(json.dumps({"event": "BRIDGE_STATUS_WRITE_FAILED",
                              "error": safe_error(error)}, ensure_ascii=False),
                  file=sys.stderr, flush=True)
            return False
    return False


def validate_url(value: str):
    url = urlsplit(value)
    if url.username or url.password or url.query or url.fragment or not url.hostname:
        raise ValueError("INVALID_NAS_URL")
    if url.scheme != "https" and not (url.scheme == "http" and url.hostname in {"127.0.0.1", "localhost", "::1"}):
        raise ValueError("NAS_HTTPS_REQUIRED")
    return value.rstrip("/")


def configuration():
    path = local_directory() / "nas-bridge.dpapi"
    if not path.is_file():
        raise RuntimeError("NAS_BRIDGE_NOT_CONFIGURED")
    if path.stat().st_size > 16384:
        raise RuntimeError("INVALID_BRIDGE_CREDENTIAL")
    config = json.loads(_transform(path.read_bytes(), protect=False, entropy=ENTROPY))
    config["url"] = validate_url(config["url"])
    if not re.fullmatch(r"[A-Za-z0-9_-]{48,128}", config["token"]):
        raise RuntimeError("INVALID_BRIDGE_CREDENTIAL")
    return config


def save_configuration(url: str, token: str):
    """Called by trusted local setup; values never belong on a command line/log."""
    url = validate_url(url)
    if not re.fullmatch(r"[A-Za-z0-9_-]{48,128}", token):
        raise ValueError("INVALID_BRIDGE_CREDENTIAL")
    directory = local_directory()
    directory.mkdir(parents=True, exist_ok=True)
    with FileLock(str(directory / "nas-bridge-credential.lock"), timeout=5):
        path = directory / "nas-bridge.dpapi"
        if path.exists():
            previous = configuration()
            if previous != {"url": url, "token": token}:
                raise RuntimeError("EXISTING_NAS_CONFIGURATION_DIFFERS")
            return
        temporary = path.with_suffix(".tmp")
        temporary.write_bytes(_transform(json.dumps({"url": url, "token": token}).encode(), protect=True, entropy=ENTROPY))
        temporary.replace(path)


class NasBridge:
    def __init__(self, nas, worker, spool: Path):
        self.nas, self.worker, self.spool = nas, worker, spool
        spool.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def data(response):
        response.raise_for_status()
        return response.json()

    def tick(self):
        try:
            health_response = self.worker.get("/health")
            if health_response.status_code not in {200, 503}:
                health_response.raise_for_status()
            health = health_response.json()
        except httpx.TransportError:
            health = {"acceptingJobs": False, "sessionId": "worker-unreachable"}
        assigned = self.data(self.nas.post("/internal/worker/poll", json={
            "ready": bool(health.get("acceptingJobs")), "sessionId": health.get("sessionId", "unknown")}))["job"]
        if not assigned:
            return {"state": "IDLE", "workerReady": bool(health.get("acceptingJobs"))}
        nas_id = str(UUID(assigned["id"]))
        previous = assigned.get("workerResult")
        if previous:
            local_id = str(UUID(previous["localJobId"]))
        else:
            if not health.get("acceptingJobs"):
                return {"state": "WAITING_FOR_WORKER", "jobId": nas_id}
            # Server may have accepted a prior POST even if its response was lost.
            response = self.worker.post("/v1/jobs", json={**assigned["request"], "requestId": "nas:" + nas_id})
            if response.status_code in {429, 503, 507}:
                return {"state": "WAITING_FOR_WORKER", "jobId": nas_id, "workerStatus": response.status_code}
            local_id = str(UUID(self.data(response)["job"]["id"]))
        if assigned["cancelRequested"]:
            self.data(self.worker.post(f"/v1/jobs/{local_id}/cancel"))
        job = self.data(self.worker.get(f"/v1/jobs/{local_id}"))
        result = {"localJobId": local_id, "workerState": job["state"], "artifacts": job["artifacts"],
                  "model": job.get("model"), "metrics": job.get("metrics"), "error": job.get("error")}
        if job.get('recognition') is not None:
            result['recognition'] = job['recognition']
        if job.get('progress') is not None:
            result['progress'] = job['progress']
        acknowledged = self.data(self.nas.post(f"/internal/jobs/{nas_id}/status", json=result))
        if job["state"] not in TERMINAL:
            return {"state": job["state"], "jobId": nas_id, "localJobId": local_id}
        for kind, artifact in job["artifacts"].items():
            if kind not in {"wav", "mp3"}:
                raise RuntimeError("UNSUPPORTED_AUDIO_FORMAT")
            if acknowledged["artifacts"].get(kind, {}).get("sha256") == artifact["sha256"]:
                continue
            path = self.spool / nas_id / f"audio.{kind}"
            path.parent.mkdir(parents=True, exist_ok=True)
            # Download from the fixed local Worker route, never a response-supplied URL.
            with self.worker.stream("GET", f"/v1/jobs/{local_id}/audio/{kind}") as response:
                response.raise_for_status()
                digest = hashlib.sha256()
                size = 0
                temporary = path.with_suffix(".partial")
                with temporary.open("wb") as handle:
                    for block in response.iter_bytes(65536):
                        size += len(block)
                        if size > artifact["bytes"] or size > 64 * 2**20:
                            raise RuntimeError("WORKER_AUDIO_SIZE_MISMATCH")
                        digest.update(block)
                        handle.write(block)
                if size != artifact["bytes"] or digest.hexdigest() != artifact["sha256"]:
                    raise RuntimeError("WORKER_AUDIO_HASH_MISMATCH")
                temporary.replace(path)
            with path.open("rb") as handle:
                response = self.nas.put(f"/internal/jobs/{nas_id}/audio/{kind}",
                                        content=iter(lambda: handle.read(65536), b""),
                                        headers={"Content-Length": str(artifact["bytes"]),
                                                 "Content-Type": "application/octet-stream"})
                self.data(response)
        final = self.data(self.nas.post(f"/internal/jobs/{nas_id}/complete"))
        return {"state": final["state"], "jobId": nas_id, "localJobId": local_id,
                "archived": sorted(final["artifacts"])}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker-port", type=int, default=8093)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    config = configuration()
    directory = Path(__file__).resolve().parents[2] / ".music-runtime" / "nas-bridge"
    directory.mkdir(parents=True, exist_ok=True)
    with FileLock(str(local_directory() / "nas-bridge.lock"), timeout=0), \
         httpx.Client(base_url=config["url"], headers={"Authorization": "Bearer " + config["token"]},
                      timeout=120, trust_env=False, follow_redirects=False) as nas, \
         httpx.Client(base_url=f"http://127.0.0.1:{args.worker_port}",
                      headers={"Authorization": "Bearer " + worker_token()},
                      timeout=30, trust_env=False, follow_redirects=False) as worker:
        bridge = NasBridge(nas, worker, directory / "spool")
        delay = 3
        while True:
            try:
                state = bridge.tick()
                delay = 3
            except Exception as error:
                state = {"state": "CONNECTION_OR_SYNC_ERROR", "error": safe_error(error)}
                delay = min(60, delay * 2)
            publish_status(directory / "status.json", {**state, "updatedAt": now()})
            if args.once:
                return 0 if "error" not in state else 1
            threading.Event().wait(delay)


if __name__ == "__main__":
    raise SystemExit(main())
