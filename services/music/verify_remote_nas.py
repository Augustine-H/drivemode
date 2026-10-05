"""Opt-in real NAS HTTPS test; credentials come only from local DPAPI files."""
import hashlib
from pathlib import Path
import time
from uuid import UUID, uuid4

import httpx

from credentials import _transform
from diagnostics import safe_error
from nas_bridge import configuration
from provider import atomic_json, verify_audio_file
from worker_auth import local_directory, worker_token


def main():
    config = configuration()
    if not config["url"].startswith("https://"):
        raise RuntimeError("REMOTE_NAS_HTTPS_REQUIRED")
    credential = local_directory() / "nas-client.dpapi"
    if credential.stat().st_size > 16384:
        raise RuntimeError("INVALID_NAS_CLIENT_CREDENTIAL")
    token = _transform(credential.read_bytes(), protect=False,
                       entropy=b"VoiceGrok.Music.NasClient.v1").decode("ascii")
    if len(token) != 64 or any(c not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_" for c in token):
        raise RuntimeError("INVALID_NAS_CLIENT_CREDENTIAL")
    folder = Path(__file__).resolve().parents[2] / ".music-runtime" / "physical-nas-verification" / str(uuid4())
    folder.mkdir(parents=True)
    report = {"passed": False, "physicalNasVerified": False, "url": config["url"], "checks": {}}
    try:
        with httpx.Client(base_url=config["url"], timeout=120, trust_env=False,
                          follow_redirects=False) as client:
            assert client.get("/health").status_code == 401
            client.headers["Authorization"] = "Bearer " + token
            health = client.get("/health")
            health.raise_for_status()
            report["health"] = health.json()
            assert report["health"]["service"] == "voice-grok-nas-music"
            request = {"requestId": "physical-nas-" + folder.name,
                       "prompt": "Instrumental ambient synthwave, rainy city night, gentle drums, no vocals",
                       "duration": 30, "seed": 4042, "bitrate": 320}
            started = time.perf_counter()
            response = client.post("/v1/jobs", json=request)
            response.raise_for_status()
            assert response.status_code == 202
            job_id = response.json()["job"]["id"]
            report.update(jobId=job_id, request=request)
            atomic_json(folder / "report.json", report)
            duplicate = client.post("/v1/jobs", json=request)
            assert duplicate.status_code == 200 and duplicate.json()["job"]["id"] == job_id
            deadline = time.monotonic() + 600
            observed = []
            while True:
                response = client.get(f"/v1/jobs/{job_id}")
                response.raise_for_status()
                job = response.json()
                report["job"] = job
                if job["state"] not in observed:
                    observed.append(job["state"])
                    print("NAS state:", job["state"], flush=True)
                if job["state"] in {"COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"}:
                    assert job["state"] == "COMPLETED", "NAS_JOB_" + job["state"]
                    break
                if time.monotonic() > deadline:
                    raise TimeoutError("NAS_FLOW_TIMEOUT_JOB_PRESERVED")
                time.sleep(2)
            report.update(states=observed, completionSeconds=round(time.perf_counter() - started, 3))
            local_id = str(UUID(job["workerResult"]["localJobId"]))
            with httpx.Client(base_url="http://127.0.0.1:8093", timeout=30, trust_env=False,
                              headers={"Authorization": "Bearer " + worker_token()}) as worker:
                local_response = worker.get(f"/v1/jobs/{local_id}")
                local_response.raise_for_status()
                local_job = local_response.json()
            assert local_job["state"] == "COMPLETED"
            assert local_job["request"]["requestId"] == "nas:" + job_id
            assert local_job["model"]["model"] == "stabilityai/stable-audio-3-small-music"
            assert "4070 Ti" in local_job["model"]["device"]
            assert local_job["artifacts"] == job["artifacts"]
            report["checks"]["matchingRealGpuWorkerJob"] = True
            assert set(job["artifacts"]) == {"wav", "mp3"}
            for kind, artifact in job["artifacts"].items():
                route = f"/v1/jobs/{job_id}/audio/{kind}"
                audio = client.get(route)
                audio.raise_for_status()
                assert len(audio.content) == artifact["bytes"]
                assert hashlib.sha256(audio.content).hexdigest() == artifact["sha256"]
                path = folder / f"nas-download.{kind}"
                path.write_bytes(audio.content)
                decoded = verify_audio_file(path)
                assert abs(decoded["duration"] - 30) < 0.1
                partial = client.get(route, headers={"Range": "bytes=0-63"})
                assert partial.status_code == 206 and partial.content == audio.content[:64]
                report["checks"][kind] = decoded
            report["checks"].update(unauthorizedRejected=True, idempotency=True,
                                    archivedHashes=True, fullDecode=True, rangeDownloads=True)
            report.update(passed=True, physicalNasVerified=True)
    except Exception as error:
        report["error"] = safe_error(error)
        raise
    finally:
        atomic_json(folder / "report.json", report)
        print("Report:", folder / "report.json", flush=True)


if __name__ == "__main__":
    main()
