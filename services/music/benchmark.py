"""Run actual GPU inference once access is granted; preserve partial results."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path
import os
import subprocess
import threading
import time
import uuid

from provider import StableAudioLocalProvider, atomic_json, encode_mp3, save_audio, validate_request
from diagnostics import safe_error


class ResourceMonitor:
    def __init__(self):
        self.stop = threading.Event()
        self.peak_rss = 0
        self.gpu_samples: list[int] = []
        self.gpu_memory_samples: list[int] = []
        self.thread = threading.Thread(target=self._sample, daemon=True)

    def _sample(self):
        import psutil
        process = psutil.Process()
        while not self.stop.is_set():
            self.peak_rss = max(self.peak_rss, process.memory_info().rss)
            try:
                output = subprocess.run(
                    ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used",
                     "--format=csv,noheader,nounits"],
                    capture_output=True, text=True, timeout=3,
                )
                fields = output.stdout.splitlines()[0].split(",")
                self.gpu_samples.append(int(fields[0].strip()))
                self.gpu_memory_samples.append(int(fields[1].strip()))
            except (OSError, ValueError, IndexError, subprocess.TimeoutExpired):
                pass
            self.stop.wait(0.5)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.stop.set()
        self.thread.join(timeout=5)

    def metrics(self):
        return {
            "peakProcessRamMiB": round(self.peak_rss / 2**20, 2),
            "gpuUtilizationPeakPercent": max(self.gpu_samples, default=None),
            "gpuMemoryDevicePeakMiB": max(self.gpu_memory_samples, default=None),
            "gpuSamples": len(self.gpu_samples),
            "gpuMetricsScope": "whole-device-including-other-apps",
            "ramMeasurement": "sampled-process-working-set",
        }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", default="Instrumental 1980s synthwave, rainy Seoul night drive, warm analog synth chords, steady drums, 100 BPM, no vocals")
    parser.add_argument("--durations", type=int, nargs="+", default=[30, 60, 120])
    parser.add_argument("--seed", type=int, default=1042)
    parser.add_argument("--bitrate", type=int, choices=[128, 192, 256, 320], default=320)
    parser.add_argument("--output", type=Path, default=Path(".music-runtime/benchmarks"))
    args = parser.parse_args()
    # Download is measured separately. Loading and inference use the official cache only.
    os.environ["HF_HUB_OFFLINE"] = "1"
    for duration in args.durations:
        validate_request(args.prompt, duration, args.seed)
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    folder = args.output / run_id
    folder.mkdir(parents=True, exist_ok=False)
    report = {"runId": run_id, "state": "LOADING", "prompt": args.prompt,
              "requestedDurations": args.durations, "seed": args.seed, "results": [],
              "apiCostUsd": 0, "qualityReview": "not-performed", "offline": True,
              "steps": 8, "cfgScale": 1.0, "chunkedDecode": True}
    report_path = folder / "benchmark.json"
    atomic_json(report_path, report)
    resources = None
    stage_started = time.perf_counter()
    try:
        provider = StableAudioLocalProvider()
        with ResourceMonitor() as resources:
            report["model"] = provider.load()
        report["loadResources"] = resources.metrics()
        atomic_json(report_path, report)
        for duration in args.durations:
            report["state"] = "GENERATING"
            report["currentDuration"] = duration
            atomic_json(report_path, report)
            print(f"Generating {duration}s…", flush=True)
            stage_started = time.perf_counter()
            with ResourceMonitor() as resources:
                waveform, sample_rate, metrics = provider.generate(args.prompt, duration, args.seed)
            report["state"] = "VERIFYING_WAV"
            wav = folder / f"synthwave-{duration}s.wav"
            wav_metadata = save_audio(waveform, sample_rate, wav)
            result = {"requestedDuration": duration, "metrics": metrics,
                      "resources": resources.metrics(), "wav": wav_metadata}
            report["results"].append(result)
            # Commit WAV provenance before attempting a separately recoverable encoding step.
            report["state"] = "ENCODING"
            atomic_json(report_path, report)
            stage_started = time.perf_counter()
            result["mp3"] = encode_mp3(wav, wav.with_suffix(".mp3"), args.bitrate)
            result["encodingAndVerificationSeconds"] = round(time.perf_counter() - stage_started, 3)
            if abs(wav_metadata["duration"] - duration) > 0.1:
                raise RuntimeError("DURATION_MISMATCH")
            if abs(result["mp3"]["decoded"]["duration"] - duration) > 0.1:
                raise RuntimeError("MP3_DURATION_MISMATCH")
            atomic_json(report_path, report)
        report["state"] = "COMPLETED"
        report["qualityReview"] = "requires-listening"
    except Exception as error:
        report["failedAtStage"] = report["state"]
        report["state"] = "FAILED"
        report["errorType"] = type(error).__name__
        report["error"] = safe_error(error)
        report["failedStageSeconds"] = round(time.perf_counter() - stage_started, 3)
        if resources is not None:
            report["failedStageResources"] = resources.metrics()
        report["filesPreserved"] = True
        print(f"Benchmark failed at {report['failedAtStage']}: {type(error).__name__}: {report['error']['message']}", flush=True)
    atomic_json(report_path, report)
    print(f"Report: {report_path}", flush=True)
    return 0 if report["state"] == "COMPLETED" else 1


if __name__ == "__main__":
    raise SystemExit(main())
