"""Local SQLite job ledger. State updates and idempotency share transactions."""
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import uuid

TERMINAL = {"COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class JobError(Exception):
    def __init__(self, code: str, status: int):
        super().__init__(code)
        self.code, self.status = code, status


class JobStore:
    def __init__(self, directory: Path, capacity: int = 8):
        self.directory = directory.resolve()
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / "jobs.sqlite3"
        self.capacity = capacity
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL,
                payload_hash TEXT NOT NULL, state TEXT NOT NULL, document TEXT NOT NULL
            )""")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        try:
            db.execute("PRAGMA synchronous=FULL")
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def write(db, job):
        job["updatedAt"] = now()
        db.execute("UPDATE jobs SET state=?, document=? WHERE id=?",
                   (job["state"], json.dumps(job, ensure_ascii=False, allow_nan=False), job["id"]))

    @staticmethod
    def read(db, job_id):
        row = db.execute("SELECT document FROM jobs WHERE id=?", (job_id,)).fetchone()
        if row is None:
            raise JobError("JOB_NOT_FOUND", 404)
        return json.loads(row[0])

    def get(self, job_id):
        with self.connect() as db:
            return self.read(db, job_id)

    def list(self, limit=20, offset=0):
        with self.connect() as db:
            return [json.loads(row[0]) for row in db.execute(
                "SELECT document FROM jobs ORDER BY rowid DESC LIMIT ? OFFSET ?", (limit, offset))]

    def enqueue(self, request):
        encoded = json.dumps(request, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        digest = hashlib.sha256(encoded.encode()).hexdigest()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT payload_hash,document FROM jobs WHERE request_id=?",
                             (request["requestId"],)).fetchone()
            if row:
                if row[0] != digest:
                    raise JobError("REQUEST_ID_CONFLICT", 409)
                return json.loads(row[1]), False
            count = db.execute("SELECT count(*) FROM jobs WHERE state NOT IN ('COMPLETED','FAILED','CANCELLED','INTERRUPTED')").fetchone()[0]
            if count >= self.capacity:
                raise JobError("QUEUE_FULL", 429)
            job = {"id": str(uuid.uuid4()), "request": request, "state": "QUEUED",
                   "createdAt": now(), "updatedAt": now(), "cancelRequested": False,
                   "artifacts": {}, "apiCostUsd": 0}
            db.execute("INSERT INTO jobs VALUES (?,?,?,?,?)", (job["id"], request["requestId"], digest,
                       job["state"], json.dumps(job, ensure_ascii=False)))
            return job, True

    def claim(self):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT document FROM jobs WHERE state='QUEUED' ORDER BY rowid LIMIT 1").fetchone()
            if not row:
                return None
            job = json.loads(row[0])
            job.update(state="LOADING", stage="LOADING", startedAt=now())
            self.write(db, job)
            return job

    def update(self, job_id, *, stage=None, **fields):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            job = self.read(db, job_id)
            job.update(fields)
            if stage:
                job["stage"] = stage
                job["state"] = "CANCEL_REQUESTED" if job["cancelRequested"] else stage
            self.write(db, job)
            return job

    def cancel(self, job_id):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            job = self.read(db, job_id)
            if job["state"] not in TERMINAL:
                job["cancelRequested"] = True
                job["state"] = "CANCELLED" if job["state"] == "QUEUED" else "CANCEL_REQUESTED"
                if job["state"] == "CANCELLED":
                    job["finishedAt"] = now()
                self.write(db, job)
            return job

    def finish(self, job_id, *, error=None):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            job = self.read(db, job_id)
            job["state"] = "FAILED" if error else ("CANCELLED" if job["cancelRequested"] else "COMPLETED")
            job["finishedAt"] = now()
            if error:
                job["error"] = error
                job["failedAtStage"] = job.get("stage")
            self.write(db, job)
            return job

    def recover(self):
        # Called only after acquiring the process lock. Never auto-repeat GPU inference.
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            rows = db.execute("SELECT document FROM jobs WHERE state NOT IN ('QUEUED','COMPLETED','FAILED','CANCELLED','INTERRUPTED')").fetchall()
            for row in rows:
                job = json.loads(row[0])
                job.update(state="INTERRUPTED", finishedAt=now(),
                           error={"type": "WorkerRestart", "message": "WORKER_INTERRUPTED: existing files preserved; submit a new requestId to retry."})
                self.write(db, job)
        return len(rows)

    def counts(self):
        with self.connect() as db:
            return dict(db.execute("SELECT state,count(*) FROM jobs GROUP BY state"))
