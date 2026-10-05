"""One persistent queue consumer, one model, one GPU job at a time."""
import os
import logging
from pathlib import Path
import shutil
import threading
import time
import uuid

from filelock import FileLock
from benchmark import ResourceMonitor
from diagnostics import safe_error
from job_store import JobError, JobStore
from provider import StableAudioLocalProvider, atomic_json, encode_mp3, save_audio
from worker_auth import local_directory

logger = logging.getLogger("music.worker")


class MusicWorker:
    def __init__(self, directory: Path, *, provider=None, capacity=8, lock_path=None, min_free_bytes=2 * 2**30):
        self.directory = directory.resolve()
        self.provider = provider if provider is not None else StableAudioLocalProvider()
        self.capacity = capacity
        self.min_free_bytes = min_free_bytes
        self.store = None
        # Lifespan acquires on the event-loop thread and releases on a shutdown thread.
        self.lock = FileLock(str(lock_path or (local_directory() / "gpu-worker.lock")), thread_local=False)
        self.wake = threading.Event()
        self.stop = threading.Event()
        self.guard = threading.Lock()
        self.thread = None
        self.session_id = str(uuid.uuid4())
        self.model_state = "UNLOADED"
        self.active_job_id = None
        self.error = None
        self.model_metadata = None

    def start(self):
        os.environ["HF_HUB_OFFLINE"] = "1"
        self.lock.acquire(timeout=0)
        try:
            self.store = JobStore(self.directory, self.capacity)
            recovered = self.store.recover()
            logger.info("session=%s recovered_interrupted=%s", self.session_id, recovered)
            self.thread = threading.Thread(target=self._run, name="music-gpu", daemon=False)
            self.thread.start()
        except BaseException:
            self.lock.release()
            raise

    def close(self):
        with self.guard:
            self.stop.set()
        self.wake.set()
        if self.thread:
            # Graceful shutdown drains only the active job. Queued work stays durable.
            self.thread.join()
        self.lock.release()

    def submit(self, request):
        with self.guard:
            if self.stop.is_set() or self.error or not self.thread or not self.thread.is_alive():
                raise JobError("WORKER_UNAVAILABLE", 503)
            if shutil.disk_usage(self.directory).free < self.min_free_bytes:
                raise JobError("INSUFFICIENT_DISK_SPACE", 507)
            result = self.store.enqueue(request)
            self.wake.set()
            return result

    def health(self):
        with self.guard:
            accepting = bool(self.thread and self.thread.is_alive() and not self.stop.is_set() and not self.error)
            return {"service": "voice-grok-music-worker", "version": 1,
                    "sessionId": self.session_id, "acceptingJobs": accepting,
                    "modelState": self.model_state, "activeJobId": self.active_job_id,
                    "queue": self.store.counts(), "capacity": self.capacity,
                    "model": self.model_metadata, "error": self.error,
                    "offline": True, "apiCostUsd": 0}

    def _run(self):
        try:
            while not self.stop.is_set():
                self.wake.clear()
                with self.guard:
                    if self.stop.is_set():
                        break
                    job = self.store.claim()
                if job is None:
                    self.wake.wait(1)
                    continue
                with self.guard:
                    self.active_job_id = job["id"]
                logger.info("jobId=%s stage=LOADING", job["id"])
                self._process(job)
                with self.guard:
                    self.active_job_id = None
                if self.error:
                    break
        except Exception as error:
            with self.guard:
                self.error = safe_error(error)
                self.model_state = "ERROR"
            logger.error("session=%s jobId=%s consumer_failed=%s", self.session_id, self.active_job_id, type(error).__name__)

    def _process(self, job):
        job_id = job["id"]
        folder = self.directory / "audio" / job_id
        request = job["request"]
        stage = "LOADING"
        try:
            folder.mkdir(parents=True, exist_ok=True)
            if self.store.get(job_id)["cancelRequested"]:
                self.store.finish(job_id)
                return
            with self.guard:
                self.model_state = "LOADING" if self.model_metadata is None else "READY"
            with ResourceMonitor() as resource:
                metadata = self.provider.load()
            with self.guard:
                self.model_metadata = metadata
                self.model_state = "READY"
            self.store.update(job_id, model=metadata, loadResources=resource.metrics())
            if self.store.get(job_id)["cancelRequested"]:
                self.store.finish(job_id)
                return
            if shutil.disk_usage(self.directory).free < self.min_free_bytes:
                raise RuntimeError("INSUFFICIENT_DISK_SPACE")
            stage = "GENERATING"
            self.store.update(job_id, stage=stage)
            logger.info("jobId=%s stage=%s", job_id, stage)
            with ResourceMonitor() as resource:
                waveform, sample_rate, metrics = self.provider.generate(request["prompt"], request["duration"], request["seed"])
            stage = "VERIFYING_WAV"
            self.store.update(job_id, stage=stage, metrics=metrics, resources=resource.metrics())
            logger.info("jobId=%s stage=%s", job_id, stage)
            wav_path = folder / "original.wav"
            wav = save_audio(waveform, sample_rate, wav_path)
            self.store.update(job_id, artifacts={"wav": wav})
            if abs(wav["duration"] - request["duration"]) > 0.1:
                raise RuntimeError("WAV_DURATION_MISMATCH")
            # A running CUDA call cannot be interrupted safely; preserve its completed WAV.
            if self.store.get(job_id)["cancelRequested"]:
                self.store.finish(job_id)
                return
            stage = "ENCODING"
            self.store.update(job_id, stage=stage)
            logger.info("jobId=%s stage=%s", job_id, stage)
            started = time.perf_counter()
            mp3 = encode_mp3(wav_path, folder / "preview.mp3", request["bitrate"])
            self.store.update(job_id, artifacts={"wav": wav, "mp3": mp3},
                              encodingAndVerificationSeconds=round(time.perf_counter() - started, 3))
            if abs(mp3["decoded"]["duration"] - request["duration"]) > 0.1:
                raise RuntimeError("MP3_DURATION_MISMATCH")
            self.store.finish(job_id)
        except Exception as error:
            detail = safe_error(error)
            self.store.finish(job_id, error=detail)
            if stage in {"LOADING", "GENERATING"}:
                # CUDA/model failures need inspection before touching the GPU again.
                with self.guard:
                    self.error = detail
                    self.model_state = "ERROR"
        finally:
            final_job = self.store.get(job_id)
            atomic_json(folder / "job.json", final_job)
            logger.info("jobId=%s state=%s", job_id, final_job["state"])
