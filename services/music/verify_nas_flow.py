"""Real HTTP/GPU integration of NAS service code on this PC, not a NAS deployment."""
import hashlib
from pathlib import Path
import secrets
import socket
import threading
import time
from uuid import uuid4

import httpx
import uvicorn

from nas_api import create_nas_app
from nas_bridge import NasBridge
from provider import atomic_json, verify_audio_file
from worker_auth import worker_token


def serve(app):
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, access_log=False, log_level="warning"))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not server.started:
        if not thread.is_alive() or time.monotonic() > deadline:
            raise RuntimeError("LOCAL_NAS_TEST_SERVER_FAILED")
        time.sleep(0.05)
    return server, thread, sock, f"http://127.0.0.1:{port}"


def stop(server, thread, sock):
    server.should_exit = True
    thread.join(timeout=15)
    sock.close()
    assert not thread.is_alive(), "LOCAL_NAS_TEST_SERVER_DID_NOT_STOP"


def main():
    root = Path(".music-runtime/nas-flow-verification") / str(uuid4())
    root.mkdir(parents=True)
    client_key, bridge_key = secrets.token_urlsafe(48), secrets.token_urlsafe(48)
    app = create_nas_app(root / "archive", client_key, bridge_key)
    server, thread, sock, url = serve(app)
    report = {"passed": False, "physicalNasVerified": False, "scope": "NAS service code hosted on Windows loopback with real CUDA Worker", "checks": {}}
    try:
        with httpx.Client(base_url=url, headers={"Authorization": "Bearer " + client_key}, timeout=120, trust_env=False) as client, \
             httpx.Client(base_url=url, headers={"Authorization": "Bearer " + bridge_key}, timeout=120, trust_env=False) as nas, \
             httpx.Client(base_url="http://127.0.0.1:8093", headers={"Authorization": "Bearer " + worker_token()}, timeout=30, trust_env=False) as worker:
            worker.get("/health").raise_for_status()
            request = {"requestId": "nas-flow-" + root.name, "prompt": "Instrumental ambient synthwave, rainy city night, gentle drums, no vocals", "duration": 30, "seed": 3042, "bitrate": 320}
            response = client.post("/v1/jobs", json=request)
            assert response.status_code == 202, response.text
            job_id = response.json()["job"]["id"]
            assert client.post("/v1/jobs", json=request).status_code == 200
            bridge = NasBridge(nas, worker, root / "spool")
            deadline = time.monotonic() + 300
            observed = []
            while True:
                status = bridge.tick()
                if status["state"] not in observed:
                    observed.append(status["state"])
                    print("Bridge state:", status["state"], flush=True)
                if status["state"] in {"COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"}:
                    assert status["state"] == "COMPLETED", status
                    break
                if time.monotonic() > deadline:
                    raise TimeoutError("NAS_FLOW_TIMEOUT")
                time.sleep(1)
            job = client.get(f"/v1/jobs/{job_id}").json()
            report.update(job=job, states=observed)
            for kind, artifact in job["artifacts"].items():
                response = client.get(f"/v1/jobs/{job_id}/audio/{kind}")
                response.raise_for_status()
                assert hashlib.sha256(response.content).hexdigest() == artifact["sha256"]
                path = root / f"nas-download.{kind}"
                path.write_bytes(response.content)
                assert verify_audio_file(path)["duration"] == 30
                partial = client.get(f"/v1/jobs/{job_id}/audio/{kind}", headers={"Range": "bytes=0-63"})
                assert partial.status_code == 206 and partial.content == response.content[:64]
            report["checks"].update(realCudaGeneration=True, archivedWavAndMp3=True,
                                    httpDownloadHashes=True, fullAudioDecode=True, rangeDownloads=True)
    finally:
        stop(server, thread, sock)
    restarted = create_nas_app(root / "archive", client_key, bridge_key)
    server, thread, sock, url = serve(restarted)
    try:
        with httpx.Client(base_url=url, headers={"Authorization": "Bearer " + client_key}, timeout=30, trust_env=False) as client:
            existing = client.get(f"/v1/jobs/{job_id}").json()
            assert existing["state"] == "COMPLETED"
            assert existing["artifacts"] == job["artifacts"]
            replay = client.post("/v1/jobs", json=request)
            assert replay.status_code == 200 and replay.json()["job"]["id"] == job_id
        report["checks"].update(nasProcessRestartPersistence=True, idempotencyAfterRestart=True)
        report["passed"] = True
        atomic_json(root / "report.json", report)
        print("Report:", root / "report.json", flush=True)
    finally:
        stop(server, thread, sock)


if __name__ == "__main__":
    main()
