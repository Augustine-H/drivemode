"""NAS-owned queue and verified archive; assignments never expire into duplicates."""
from datetime import datetime, timezone
import json
from pathlib import Path

from job_store import JobError, JobStore, TERMINAL, now
from provider import atomic_json


class NasStore(JobStore):
    def __init__(self, directory: Path, capacity=100):
        super().__init__(directory, capacity)
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")

    def poll(self, ready: bool, session_id: str):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            heartbeat = {"seenAt": now(), "ready": ready, "sessionId": session_id}
            db.execute("INSERT OR REPLACE INTO settings VALUES ('heartbeat',?)", (json.dumps(heartbeat),))
            row = db.execute("SELECT document FROM jobs WHERE state NOT IN ('QUEUED','COMPLETED','FAILED','CANCELLED','INTERRUPTED') ORDER BY rowid LIMIT 1").fetchone()
            if row:
                return json.loads(row[0])
            if not ready:
                return None
            row = db.execute("SELECT document FROM jobs WHERE state='QUEUED' ORDER BY rowid LIMIT 1").fetchone()
            if not row:
                return None
            job = json.loads(row[0])
            job.update(state="DISPATCHED", dispatchedAt=now())
            self.write(db, job)
            return job

    def health(self):
        with self.connect() as db:
            row = db.execute("SELECT value FROM settings WHERE key='heartbeat'").fetchone()
        heartbeat = json.loads(row[0]) if row else None
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(heartbeat["seenAt"])).total_seconds() if heartbeat else None
        fresh = age is not None and 0 <= age <= 30
        return {"service": "voice-grok-nas-music", "queue": self.counts(),
                "supportedTasks": ["instrumental", "song", "recognition"],
                "workerState": ("READY" if heartbeat["ready"] else "UNAVAILABLE") if fresh else "UNKNOWN",
                "lastHeartbeat": heartbeat, "heartbeatAgeSeconds": round(age, 1) if age is not None else None,
                "wolEnabled": False, "apiCostUsd": 0}

    def report(self, job_id, result):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            job = self.read(db, job_id)
            if job["state"] == "QUEUED":
                raise JobError("JOB_NOT_DISPATCHED", 409)
            previous = job.get("workerResult")
            if previous and previous["localJobId"] != result["localJobId"]:
                raise JobError("WORKER_JOB_CONFLICT", 409)
            if job["state"] in TERMINAL:
                return job
            for kind, artifact in job["artifacts"].items():
                expected = result["artifacts"].get(kind)
                if not expected or expected["sha256"] != artifact["sha256"]:
                    raise JobError("ARTIFACT_CHANGED", 409)
            recognition = job['request'].get('kind') == 'recognition'
            if result['workerState'] == 'COMPLETED' and recognition and (not result.get('recognition') or result['artifacts']):
                raise JobError('RECOGNITION_RESULT_MISSING', 409)
            if result["workerState"] == "COMPLETED" and not recognition and set(result["artifacts"]) != {"wav", "mp3"}:
                raise JobError("COMPLETED_AUDIO_MISSING", 409)
            job["workerResult"] = result
            job["workerState"] = result["workerState"]
            if result["workerState"] in TERMINAL:
                job["state"] = "UPLOADING"
            elif not job["cancelRequested"]:
                job["state"] = "DISPATCHED" if result["workerState"] == "QUEUED" else result["workerState"]
            self.write(db, job)
            return job

    def expected_artifact(self, job_id, kind):
        job = self.get(job_id)
        expected = job.get("workerResult", {}).get("artifacts", {}).get(kind)
        if not expected or job.get("workerState") not in TERMINAL:
            raise JobError("UPLOAD_NOT_EXPECTED", 409)
        return expected

    def record_artifact(self, job_id, kind, metadata):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            job = self.read(db, job_id)
            expected = job.get("workerResult", {}).get("artifacts", {}).get(kind)
            if not expected or expected["sha256"] != metadata["sha256"]:
                raise JobError("ARTIFACT_CHANGED", 409)
            job["artifacts"][kind] = metadata
            self.write(db, job)
            return job

    def finalize(self, job_id):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            job = self.read(db, job_id)
            if job["state"] in TERMINAL:
                return job
            result = job.get("workerResult")
            if not result or result["workerState"] not in TERMINAL:
                raise JobError("WORKER_NOT_FINISHED", 409)
            for kind, expected in result["artifacts"].items():
                actual = job["artifacts"].get(kind)
                if not actual or actual["sha256"] != expected["sha256"]:
                    raise JobError("ARCHIVE_INCOMPLETE", 409)
                if not self.audio_path(job_id, kind).is_file():
                    raise JobError("ARCHIVE_FILE_MISSING", 409)
            job["state"] = "CANCELLED" if job["cancelRequested"] and result["workerState"] == "COMPLETED" else result["workerState"]
            job["finishedAt"] = now()
            job['request'].pop('audioBase64', None)
            # Write recoverable metadata before committing terminal state.
            atomic_json(self.directory / "media" / job_id / "metadata.json", job)
            self.write(db, job)
            return job

    def audio_path(self, job_id, kind):
        # IDs and format are validated UUID/enum at the API boundary.
        return self.directory / "media" / job_id / ("original.wav" if kind == "wav" else "preview.mp3")
