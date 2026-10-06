import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
import os
from unittest.mock import patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
import httpx
from nas_api import create_nas_app
from nas_bridge import NasBridge, configuration, save_configuration, validate_url
from nas_store import NasStore

CLIENT = "client-test-" + "c" * 52
BRIDGE = "bridge-test-" + "b" * 52


def body(key="nas-test"):
    return {"requestId": key, "prompt": "Instrumental test fixture", "duration": 1, "seed": 1042, "bitrate": 320}


class NasTests(unittest.TestCase):
    def test_full_file_api_progress_recovery_and_input_cleanup(self):
        from test_lyrics_chunks import body as recognition_body
        health = self.client.get('/health', headers=self.user).json()
        self.assertEqual(health['fullFileTranscriptionMaxSeconds'], 600)
        response = self.client.post('/v1/jobs', json=recognition_body(), headers=self.user)
        self.assertEqual(response.status_code, 202)
        job = response.json()['job']
        self.assertNotIn('audioBase64', job['request'])
        self.poll()
        progress = dict(completedChunks=1, totalChunks=2, processedSeconds=30, totalSeconds=36)
        result = dict(localJobId=str(uuid4()), workerState='GENERATING', artifacts={}, progress=progress)
        endpoint = f"/internal/jobs/{job['id']}/status"
        self.assertEqual(self.client.post(endpoint, json=result, headers=self.agent).status_code, 200)
        restored = self.client.get(f"/v1/jobs/{job['id']}", headers=self.user).json()
        self.assertEqual(restored['workerResult']['progress'], progress)
        result.update(workerState='COMPLETED', recognition=dict(transcription='local result', warnings=[]))
        self.assertEqual(self.client.post(endpoint, json=result, headers=self.agent).status_code, 200)
        final = self.client.post(f"/internal/jobs/{job['id']}/complete", headers=self.agent).json()
        self.assertEqual(final['state'], 'COMPLETED')
        self.assertNotIn('audioBase64', self.app.state.store.get(job['id'])['request'])

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.app = create_nas_app(self.root, CLIENT, BRIDGE, min_free_bytes=0)
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.user = {"Authorization": "Bearer " + CLIENT}
        self.agent = {"Authorization": "Bearer " + BRIDGE}

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.temp.cleanup()

    def submit(self, key="nas-test"):
        response = self.client.post("/v1/jobs", json=body(key), headers=self.user)
        self.assertEqual(response.status_code, 202)
        return response.json()["job"]

    def poll(self, ready=True):
        response = self.client.post("/internal/worker/poll", json={"ready": ready, "sessionId": "test"}, headers=self.agent)
        self.assertEqual(response.status_code, 200)
        return response.json()["job"]

    def report(self, job, state="COMPLETED", payloads=None):
        if payloads is None:
            payloads = {"wav": b"wav-fixture", "mp3": b"mp3-fixture"}
        result = {"localJobId": str(uuid4()), "workerState": state, "artifacts": {
            kind: {"bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()} for kind, content in payloads.items()}}
        response = self.client.post(f"/internal/jobs/{job['id']}/status", json=result, headers=self.agent)
        self.assertEqual(response.status_code, 200, response.text)
        return result

    def test_roles_origin_validation_and_idempotency(self):
        self.assertEqual(self.client.get("/health").status_code, 401)
        self.assertEqual(self.client.get("/health", headers=self.agent).status_code, 401)
        self.assertEqual(self.client.post("/internal/worker/poll", json={"ready": True, "sessionId": "x"}, headers=self.user).status_code, 401)
        self.assertEqual(self.client.get("/health", headers={**self.user, "Origin": "https://evil.test"}).status_code, 403)
        self.assertEqual(self.client.get("/health", headers=self.user).json()["workerState"], "UNKNOWN")
        first = self.submit()
        replay = self.client.post("/v1/jobs", json=body(), headers=self.user)
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json()["job"]["id"], first["id"])
        self.assertEqual(self.client.post("/v1/jobs", json={**body(), "duration": 2}, headers=self.user).status_code, 409)

    def test_no_duplicate_assignment_after_restart_or_worker_queued_report(self):
        job = self.submit()
        second = self.submit("second")
        self.assertIsNone(self.poll(False))
        self.assertEqual(self.poll()["id"], job["id"])
        self.report(job, "QUEUED", {})
        self.assertEqual(self.poll()["id"], job["id"])
        reopened = NasStore(self.root)
        self.assertEqual(reopened.poll(True, "new-session")["id"], job["id"])
        self.assertEqual(reopened.get(second["id"])["state"], "QUEUED")
        cancelled = self.client.post(f"/v1/jobs/{job['id']}/cancel", headers=self.user)
        self.assertEqual(cancelled.json()["state"], "CANCEL_REQUESTED")

    def test_verified_upload_finalize_range_and_retry(self):
        job = self.submit()
        self.poll()
        payloads = {"wav": b"x" * 32768, "mp3": b"y" * 20000}
        self.report(job, payloads=payloads)
        self.assertEqual(self.client.post(f"/internal/jobs/{job['id']}/complete", headers=self.agent).status_code, 409)
        for kind, content in payloads.items():
            url = f"/internal/jobs/{job['id']}/audio/{kind}"
            self.assertEqual(self.client.put(url, content=content, headers=self.user).status_code, 401)
            response = self.client.put(url, content=content, headers=self.agent)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertTrue(self.client.put(url, content=content, headers=self.agent).json()["reused"])
        completed = self.client.post(f"/internal/jobs/{job['id']}/complete", headers=self.agent)
        self.assertEqual(completed.json()["state"], "COMPLETED")
        self.assertEqual(json.loads((self.root / "media" / job["id"] / "metadata.json").read_text())["state"], "COMPLETED")
        audio = self.client.get(f"/v1/jobs/{job['id']}/audio/wav", headers={**self.user, "Range": "bytes=10-19"})
        self.assertEqual(audio.status_code, 206)
        self.assertEqual(audio.content, payloads["wav"][10:20])
        self.assertIsNone(self.poll())

    def test_corrupt_or_large_upload_never_publishes(self):
        job = self.submit()
        self.poll()
        self.report(job, payloads={"wav": b"original", "mp3": b"mp3"})
        url = f"/internal/jobs/{job['id']}/audio/wav"
        self.assertEqual(self.client.put(url, content=b"corrupt!", headers=self.agent).status_code, 422)
        self.assertEqual(self.client.put(url, content=b"much-too-large", headers=self.agent).status_code, 413)
        self.assertFalse((self.root / "media" / job["id"] / "original.wav").exists())
        self.assertEqual(self.app.state.store.get(job["id"])["artifacts"], {})
        self.assertEqual(list((self.root / "media" / job["id"]).glob("*.partial")), [])

    def test_failed_worker_wav_archives_without_false_completed(self):
        job = self.submit()
        self.poll()
        self.report(job, "FAILED", {"wav": b"preserved"})
        self.client.put(f"/internal/jobs/{job['id']}/audio/wav", content=b"preserved", headers=self.agent).raise_for_status()
        result = self.client.post(f"/internal/jobs/{job['id']}/complete", headers=self.agent).json()
        self.assertEqual(result["state"], "FAILED")
        self.assertEqual(self.client.get(f"/v1/jobs/{job['id']}/audio/wav", headers=self.user).content, b"preserved")

    def test_queued_cancel_never_dispatched(self):
        job = self.submit()
        response = self.client.post(f"/v1/jobs/{job['id']}/cancel", headers=self.user)
        self.assertEqual(response.json()["state"], "CANCELLED")
        self.assertIsNone(self.poll())

    def test_bridge_reconciles_lost_response_without_regeneration(self):
        job = self.submit()
        local_id = str(uuid4())
        posted = []
        payloads = {"wav": b"wav-content", "mp3": b"mp3-content"}
        artifacts = {kind: {"bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()} for kind, content in payloads.items()}

        def worker_api(request):
            if request.url.path == "/health":
                return httpx.Response(200, json={"acceptingJobs": True, "sessionId": "local-test"})
            if request.method == "POST" and request.url.path == "/v1/jobs":
                posted.append(json.loads(request.content)["requestId"])
                if len(posted) == 1:
                    raise httpx.ReadTimeout("Response lost after acceptance")
                return httpx.Response(200, json={"created": False, "job": {"id": local_id}})
            if request.url.path.endswith("/audio/wav"):
                return httpx.Response(200, content=payloads["wav"])
            if request.url.path.endswith("/audio/mp3"):
                return httpx.Response(200, content=payloads["mp3"])
            return httpx.Response(200, json={"id": local_id, "state": "COMPLETED", "artifacts": artifacts})

        with httpx.Client(base_url="http://127.0.0.1:8093", transport=httpx.MockTransport(worker_api)) as worker:
            self.client.headers.update(self.agent)
            bridge = NasBridge(self.client, worker, self.root / "spool")
            with self.assertRaises(httpx.ReadTimeout):
                bridge.tick()
            result = bridge.tick()
            self.assertEqual(result["state"], "COMPLETED")
            self.assertEqual(posted, ["nas:" + job["id"]] * 2)
            self.assertEqual(bridge.tick()["state"], "IDLE")

    def test_https_required_outside_loopback(self):
        for url in ("http://nas.example", "https://user:password@nas.example", "https://nas.example/?token=x"):
            with self.assertRaises(ValueError):
                validate_url(url)
        self.assertEqual(validate_url("https://nas.example/music/"), "https://nas.example/music")

    @unittest.skipUnless(os.name == "nt", "Windows DPAPI")
    def test_bridge_configuration_encrypted_and_no_silent_replacement(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"LOCALAPPDATA": folder}):
            save_configuration("https://nas.example/music", BRIDGE)
            saved = configuration()
            self.assertEqual(saved["token"], BRIDGE)
            credential = Path(folder) / "VoiceGrok/Music/nas-bridge.dpapi"
            self.assertNotIn(BRIDGE.encode(), credential.read_bytes())
            save_configuration("https://nas.example/music", BRIDGE)
            with self.assertRaisesRegex(RuntimeError, "EXISTING_NAS_CONFIGURATION_DIFFERS"):
                save_configuration("https://another.example/music", BRIDGE)

    def test_stale_heartbeat_means_unknown_and_keeps_assignment(self):
        job = self.submit()
        self.poll()
        with self.app.state.store.connect() as db:
            db.execute("UPDATE settings SET value=? WHERE key='heartbeat'", (json.dumps({
                "seenAt": "2020-01-01T00:00:00+00:00", "ready": True, "sessionId": "old"}),))
        self.assertEqual(self.app.state.store.health()["workerState"], "UNKNOWN")
        self.assertEqual(self.poll()["id"], job["id"])

    def test_upload_conflict_preserves_existing_archive(self):
        job = self.submit()
        self.poll()
        self.report(job, payloads={"wav": b"expected", "mp3": b"mp3"})
        path = self.app.state.store.audio_path(job["id"], "wav")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"different-file-already-here")
        result = self.client.put(f"/internal/jobs/{job['id']}/audio/wav", content=b"expected", headers=self.agent)
        self.assertEqual(result.status_code, 409)
        self.assertEqual(path.read_bytes(), b"different-file-already-here")


if __name__ == "__main__":
    unittest.main()
