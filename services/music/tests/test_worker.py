from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from filelock import Timeout
from job_store import JobError, JobStore
from worker import MusicWorker
from worker_api import create_app

TOKEN = "unit-test-credential-" + "a" * 44


def request(key="test-1", duration=1):
    return {"requestId": key, "prompt": "Test fixture only", "duration": duration, "seed": 1042, "bitrate": 320}


class ControlledProvider:
    """Deterministic fixture only. Never wired into the running production API."""
    def __init__(self, blocked=False, fail=False):
        self.entered = threading.Event()
        self.release = threading.Event()
        if not blocked:
            self.release.set()
        self.calls = 0
        self.simultaneous = 0
        self.max_simultaneous = 0
        self.fail = fail

    def load(self):
        return {"provider": "test-fixture", "sampleRate": 44100}

    def generate(self, prompt, duration, seed):
        import numpy as np
        self.calls += 1
        self.simultaneous += 1
        self.max_simultaneous = max(self.max_simultaneous, self.simultaneous)
        self.entered.set()
        try:
            if not self.release.wait(10):
                raise TimeoutError("Test fixture was not released")
            if self.fail:
                raise RuntimeError("TEST_CUDA_FAILURE")
            mono = (0.1 * np.sin(np.arange(duration * 44100) * (2 * np.pi * 440 / 44100))).astype(np.float32)
            return np.column_stack([mono, mono]), 44100, {"generationSeconds": 0.01}
        finally:
            self.simultaneous -= 1


def wait_terminal(store, job_id, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = store.get(job_id)
        if job["state"] in {"COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"}:
            return job
        time.sleep(0.03)
    raise AssertionError(f"Job did not finish: {store.get(job_id)['state']}")


class StoreTests(unittest.TestCase):
    def test_concurrent_idempotency_conflict_and_capacity(self):
        with tempfile.TemporaryDirectory() as folder:
            store = JobStore(Path(folder), capacity=1)
            with ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(lambda _: store.enqueue(request()), range(16)))
            self.assertEqual(sum(created for _, created in results), 1)
            self.assertEqual(len({job["id"] for job, _ in results}), 1)
            with self.assertRaisesRegex(JobError, "REQUEST_ID_CONFLICT"):
                store.enqueue(request(duration=2))
            with self.assertRaisesRegex(JobError, "QUEUE_FULL"):
                store.enqueue(request("second"))

    def test_restart_preserves_artifacts_and_never_requeues_inflight(self):
        with tempfile.TemporaryDirectory() as folder:
            store = JobStore(Path(folder))
            job, _ = store.enqueue(request())
            store.claim()
            store.update(job["id"], stage="ENCODING", artifacts={"wav": {"bytes": 42}})
            queued, _ = store.enqueue(request("queued"))
            cancelled, _ = store.enqueue(request("cancelled"))
            store.cancel(cancelled["id"])
            reopened = JobStore(Path(folder))
            self.assertEqual(reopened.recover(), 1)
            self.assertEqual(reopened.get(job["id"])["state"], "INTERRUPTED")
            self.assertIn("wav", reopened.get(job["id"])["artifacts"])
            self.assertEqual(reopened.claim()["id"], queued["id"])
            self.assertIsNone(reopened.claim())
            self.assertFalse(reopened.enqueue(request())[1])


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.provider = ControlledProvider(blocked=True)
        self.worker = MusicWorker(self.directory, provider=self.provider,
                                  lock_path=self.directory / "gpu.lock", min_free_bytes=0)
        self.client = TestClient(create_app(self.worker, TOKEN))
        self.client.__enter__()
        self.headers = {"Authorization": "Bearer " + TOKEN}

    def tearDown(self):
        self.provider.release.set()
        self.client.__exit__(None, None, None)
        self.temp.cleanup()

    def post(self, value):
        return self.client.post("/v1/jobs", json=value, headers=self.headers)

    def test_auth_validation_body_limit_and_no_browser_access(self):
        for url in ("/health", "/v1/jobs", "/openapi.json"):
            self.assertEqual(self.client.get(url).status_code, 401)
        self.assertEqual(self.client.get("/health", headers={"Authorization": "Bearer invalid"}).status_code, 401)
        self.assertEqual(self.client.get("/health", headers={**self.headers, "Origin": "https://example.com"}).status_code, 403)
        self.assertEqual(self.client.get("/health", headers={**self.headers, "Host": "evil.example"}).status_code, 400)
        invalid = [dict(request(), duration=121), dict(request(), duration=True),
                   dict(request(), prompt="  "), dict(request(), seed=-1), dict(request(), extra="secret-input")]
        for body in invalid:
            response = self.post(body)
            self.assertEqual(response.status_code, 422)
            self.assertNotIn("secret-input", response.text)
        response = self.client.post("/v1/jobs", content=b"x" * 17000, headers=self.headers)
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.worker.store.counts(), {})

    def test_serial_jobs_download_range_and_idempotency(self):
        first = self.post(request()).json()["job"]
        self.assertTrue(self.provider.entered.wait(5))
        second = self.post(request("second")).json()["job"]
        duplicate = self.post(request())
        self.assertEqual(duplicate.status_code, 200)
        self.assertFalse(duplicate.json()["created"])
        self.assertEqual(self.post(request(duration=2)).status_code, 409)
        self.assertEqual(self.provider.calls, 1)
        self.assertEqual(self.client.get("/health", headers=self.headers).status_code, 200)
        self.provider.release.set()
        completed = wait_terminal(self.worker.store, second["id"])
        self.assertEqual(completed["state"], "COMPLETED")
        self.assertEqual(self.provider.max_simultaneous, 1)
        self.assertEqual(self.provider.calls, 2)
        job = self.client.get(f"/v1/jobs/{first['id']}", headers=self.headers).json()
        for format in ("wav", "mp3"):
            url = job["downloads"][format]
            self.assertEqual(self.client.get(url).status_code, 401)
            full = self.client.get(url, headers=self.headers)
            self.assertEqual(full.status_code, 200)
            self.assertEqual(len(full.content), job["artifacts"][format]["bytes"])
            partial = self.client.get(url, headers={**self.headers, "Range": "bytes=0-63"})
            self.assertEqual(partial.status_code, 206)
            self.assertEqual(partial.content, full.content[:64])
            self.assertEqual(self.client.head(url, headers=self.headers).content, b"")
            self.assertEqual(self.client.get(url, headers={**self.headers, "Range": "bytes=999999999-"}).status_code, 416)

    def test_cancel_queued_and_running_preserves_generated_wav(self):
        first = self.post(request()).json()["job"]
        self.assertTrue(self.provider.entered.wait(5))
        second = self.post(request("second")).json()["job"]
        queued = self.client.post(f"/v1/jobs/{second['id']}/cancel", headers=self.headers)
        self.assertEqual(queued.json()["state"], "CANCELLED")
        running = self.client.post(f"/v1/jobs/{first['id']}/cancel", headers=self.headers)
        self.assertEqual(running.status_code, 202)
        self.assertEqual(running.json()["state"], "CANCEL_REQUESTED")
        self.provider.release.set()
        result = wait_terminal(self.worker.store, first["id"])
        self.assertEqual(result["state"], "CANCELLED")
        self.assertIn("wav", result["artifacts"])
        self.assertNotIn("mp3", result["artifacts"])
        self.assertEqual(self.provider.calls, 1)

    def test_encoding_failure_leaves_wav_downloadable(self):
        with patch("worker.encode_mp3", side_effect=RuntimeError("ENCODING_FAILED")):
            job = self.post(request()).json()["job"]
            self.provider.release.set()
            result = wait_terminal(self.worker.store, job["id"])
        self.assertEqual(result["state"], "FAILED")
        self.assertEqual(result["failedAtStage"], "ENCODING")
        self.assertIn("wav", result["artifacts"])
        self.assertEqual(self.client.get(f"/v1/jobs/{job['id']}/audio/wav", headers=self.headers).status_code, 200)
        public = self.client.get(f"/v1/jobs/{job['id']}", headers=self.headers).json()
        self.assertNotIn("traceback", public["error"])
        self.assertTrue(self.worker.health()["acceptingJobs"])

    def test_gpu_failure_stops_further_dispatch(self):
        self.provider.fail = True
        first = self.post(request()).json()["job"]
        self.assertTrue(self.provider.entered.wait(5))
        second = self.post(request("second")).json()["job"]
        self.provider.release.set()
        self.assertEqual(wait_terminal(self.worker.store, first["id"])["state"], "FAILED")
        self.worker.thread.join(timeout=5)
        self.assertEqual(self.worker.store.get(second["id"])["state"], "QUEUED")
        self.assertEqual(self.client.get("/health", headers=self.headers).status_code, 503)
        self.assertEqual(self.post(request("third")).status_code, 503)

    def test_second_process_lock_and_disk_guard(self):
        other = MusicWorker(self.directory, provider=ControlledProvider(), lock_path=self.directory / "gpu.lock")
        with self.assertRaises(Timeout):
            other.start()
        self.worker.min_free_bytes = 2**62
        self.assertEqual(self.post(request()).status_code, 507)

    def test_design_route_aliases_share_the_same_job_ledger(self):
        response = self.client.post("/generate", json=request(), headers=self.headers)
        self.assertEqual(response.status_code, 202)
        job_id = response.json()["job"]["id"]
        self.assertEqual(self.client.get(f"/status/{job_id}", headers=self.headers).json()["id"], job_id)
        self.assertEqual(self.client.get("/jobs", headers=self.headers).json()["jobs"][0]["id"], job_id)
        self.assertIn(self.client.post(f"/cancel/{job_id}", headers=self.headers).json()["state"],
                      {"CANCELLED", "CANCEL_REQUESTED"})

    def test_shutdown_drains_active_preserves_queue_and_releases_lock(self):
        first = self.post(request()).json()["job"]
        self.assertTrue(self.provider.entered.wait(5))
        second = self.post(request("second")).json()["job"]
        closer = threading.Thread(target=self.worker.close)
        closer.start()
        self.assertTrue(self.worker.stop.wait(5))
        self.provider.release.set()
        closer.join(timeout=10)
        self.assertFalse(closer.is_alive())
        self.assertEqual(self.worker.store.get(first["id"])["state"], "COMPLETED")
        self.assertEqual(self.worker.store.get(second["id"])["state"], "QUEUED")
        other = MusicWorker(self.directory, provider=ControlledProvider(), lock_path=self.directory / "gpu.lock", min_free_bytes=0)
        other.start()
        try:
            self.assertEqual(wait_terminal(other.store, second["id"])["state"], "COMPLETED")
        finally:
            other.close()


if __name__ == "__main__":
    unittest.main()
