"""Opt-in real CUDA/API integration check; no credentials printed or saved."""
import argparse
import hashlib
import json
from pathlib import Path
import time
import uuid

import httpx

from provider import atomic_json, verify_audio_file
from worker_auth import worker_token


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8093)
    parser.add_argument("--output", type=Path, default=Path(".music-runtime/worker-api-verification"))
    parser.add_argument("--verify-restart", type=Path, help="Verify an existing successful report after restarting the Worker; no new generation")
    args = parser.parse_args()
    if args.verify_restart:
        report = json.loads(args.verify_restart.read_text(encoding="utf-8"))
        assert report["passed"]
        with httpx.Client(base_url=f"http://127.0.0.1:{args.port}", timeout=15, trust_env=False,
                          headers={"Authorization": "Bearer " + worker_token()}) as client:
            health = client.get("/health")
            health.raise_for_status()
            assert health.json()["sessionId"] != report["sessionId"]
            for original in report["jobs"]:
                response = client.get(f"/v1/jobs/{original['id']}")
                response.raise_for_status()
                job = response.json()
                assert job["state"] == "COMPLETED"
                assert job["artifacts"] == original["artifacts"]
                for format, url in job["downloads"].items():
                    response = client.get(url)
                    response.raise_for_status()
                    assert hashlib.sha256(response.content).hexdigest() == job["artifacts"][format]["sha256"]
                replay = client.post("/v1/jobs", json=original["request"])
                assert replay.status_code == 200 and replay.json()["job"]["id"] == original["id"]
            cancelled = client.get(f"/v1/jobs/{report['checks']['cancelledJobId']}").json()
            assert cancelled["state"] == "CANCELLED"
            assert client.get("/health").json()["modelState"] == "UNLOADED"
        report["checks"].update(restartPersistence=True, restartDownloads=True,
                                restartIdempotency=True, noRegenerationOnRestart=True)
        atomic_json(args.verify_restart, report)
        print("Restart verification passed: records, credentials, audio hashes and idempotency preserved.")
        return
    folder = args.output / str(uuid.uuid4())
    folder.mkdir(parents=True)
    prefix = "api-check-" + folder.name
    report = {"passed": False, "jobs": [], "checks": {}, "apiCostUsd": 0}
    with httpx.Client(base_url=f"http://127.0.0.1:{args.port}", timeout=15, trust_env=False) as client:
        assert client.get("/health").status_code == 401
        client.headers["Authorization"] = "Bearer " + worker_token()
        health = client.get("/health")
        health.raise_for_status()
        report["sessionId"] = health.json()["sessionId"]
        body = {"requestId": prefix + "-30", "prompt": "Instrumental synthwave, rainy Seoul night drive, warm analog synths, steady drums, no vocals", "duration": 30, "seed": 2042}
        response = client.post("/v1/jobs", json=body)
        assert response.status_code == 202, response.text
        first = response.json()["job"]
        duplicate = client.post("/v1/jobs", json=body)
        assert duplicate.status_code == 200 and duplicate.json()["job"]["id"] == first["id"]
        assert client.post("/v1/jobs", json={**body, "duration": 60}).status_code == 409
        second_response = client.post("/v1/jobs", json={**body, "requestId": prefix + "-60", "duration": 60})
        assert second_response.status_code == 202, second_response.text
        second = second_response.json()["job"]
        third_response = client.post("/v1/jobs", json={**body, "requestId": prefix + "-cancel"})
        assert third_response.status_code == 202
        third = third_response.json()["job"]
        cancelled = client.post(f"/v1/jobs/{third['id']}/cancel")
        assert cancelled.status_code == 200 and cancelled.json()["state"] == "CANCELLED"
        report["checks"].update(unauthorizedRejected=True, idempotency=True, conflictRejected=True,
                                queuedCancellation=True, cancelledJobId=third["id"])
        poll_peak_seconds = 0
        for initial in (first, second):
            deadline = time.monotonic() + 300
            while True:
                started = time.perf_counter()
                response = client.get(f"/v1/jobs/{initial['id']}")
                response.raise_for_status()
                poll_peak_seconds = max(poll_peak_seconds, time.perf_counter() - started)
                job = response.json()
                if job["state"] in {"COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"}:
                    break
                if time.monotonic() > deadline:
                    raise TimeoutError(f"API_JOB_TIMEOUT: {initial['id']}")
                time.sleep(1)
            report["jobs"].append(job)
            atomic_json(folder / "report.json", report)
            assert job["state"] == "COMPLETED", job.get("error")
            for format, url in job["downloads"].items():
                artifact = job["artifacts"][format]
                response = client.get(url)
                response.raise_for_status()
                assert hashlib.sha256(response.content).hexdigest() == artifact["sha256"]
                assert len(response.content) == artifact["bytes"]
                path = folder / f"{job['request']['duration']}s.{format}"
                path.write_bytes(response.content)
                decoded = verify_audio_file(path)
                assert abs(decoded["duration"] - job["request"]["duration"]) < 0.1
                partial = client.get(url, headers={"Range": "bytes=0-63"})
                assert partial.status_code == 206 and partial.content == response.content[:64]
            print(f"API generated and downloaded {job['request']['duration']}s WAV/MP3: {job['id']}", flush=True)
        assert report["jobs"][1]["startedAt"] >= report["jobs"][0]["finishedAt"]
        report["checks"].update(serialExecution=True, downloadHashes=True, fullAudioDecode=True,
                                rangeDownloads=True, pollPeakSeconds=round(poll_peak_seconds, 3))
        report["passed"] = True
        atomic_json(folder / "report.json", report)
    print(f"Report: {folder / 'report.json'}", flush=True)


if __name__ == "__main__":
    main()
