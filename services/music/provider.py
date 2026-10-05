"""Local-only Stable Audio adapter. No paid provider or synthetic fallback."""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import time
from typing import Protocol


class MusicProvider(Protocol):
    def load(self) -> dict: ...
    def generate(self, prompt: str, duration: float, seed: int) -> tuple: ...


MODEL_NAME = "small-music"
MAX_DURATION = 120


def validate_request(prompt: str, duration: float, seed: int) -> None:
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 2000:
        raise ValueError("Prompt must contain 1–2000 characters.")
    if isinstance(duration, bool) or not isinstance(duration, (int, float)):
        raise ValueError("Duration must be a number.")
    if not math.isfinite(duration) or not 1 <= duration <= MAX_DURATION:
        raise ValueError(f"Duration must be between 1 and {MAX_DURATION} seconds.")
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed <= 2**31 - 1:
        raise ValueError("Seed must be an integer from 0 to 2147483647.")


def atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2, allow_nan=False)
        handle.flush()
        os.fsync(handle.fileno())
    temporary.replace(path)


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


class StableAudioLocalProvider:
    """Load the official Small Music model; fail closed if CUDA is unavailable."""

    def __init__(self):
        self.model = None
        self.metadata: dict = {}

    def load(self) -> dict:
        if self.model is not None:
            return self.metadata
        # Native Windows: no Triton/compiler dependency for the initial baseline.
        os.environ.setdefault("ENABLE_TORCH_COMPILE", "0")
        from credentials import configure_huggingface
        configure_huggingface()
        import torch
        from stable_audio_3 import StableAudioModel
        from stable_audio_3.model_configs import models
        from huggingface_hub import try_to_load_from_cache

        if not torch.cuda.is_available():
            raise RuntimeError("CUDA_NOT_AVAILABLE: this worker requires a CUDA GPU.")
        started = time.perf_counter()
        torch.cuda.reset_peak_memory_stats()
        model = StableAudioModel.from_pretrained(MODEL_NAME, device="cuda", model_half=True)
        torch.cuda.synchronize()
        entry = models[MODEL_NAME]
        cached = try_to_load_from_cache(entry.repo_id, entry.ckpt_path)
        # The snapshot directory identifies the downloaded weights, not an assumed version.
        revision = Path(cached).parent.name if isinstance(cached, str) else None
        config = model.model_config
        self.metadata = {
            "provider": "stable_audio_local",
            "model": entry.repo_id,
            "modelRevision": revision,
            "modelConfigSha256": hashlib.sha256(
                json.dumps(config, sort_keys=True).encode()
            ).hexdigest(),
            "sampleRate": int(model.model.sample_rate),
            "sampleSize": int(config["sample_size"]),
            "maxDuration": MAX_DURATION,
            "device": torch.cuda.get_device_name(),
            "torch": torch.__version__,
            "cuda": torch.version.cuda,
            "loadSeconds": round(time.perf_counter() - started, 3),
            "loadPeakAllocatedMiB": round(torch.cuda.max_memory_allocated() / 2**20, 2),
            "apiCostUsd": 0,
            "local": True,
        }
        self.model = model
        return self.metadata

    def generate(self, prompt: str, duration: float, seed: int) -> tuple:
        validate_request(prompt, duration, seed)
        self.load()
        import torch

        torch.cuda.reset_peak_memory_stats()
        started = time.perf_counter()
        audio = self.model.generate(
            prompt=prompt.strip(), duration=duration, steps=8, cfg_scale=1.0,
            seed=seed, batch_size=1, sample_size=self.metadata["sampleSize"],
            chunked_decode=True,
        )
        torch.cuda.synchronize()
        metrics = {
            "generationSeconds": round(time.perf_counter() - started, 3),
            "peakAllocatedMiB": round(torch.cuda.max_memory_allocated() / 2**20, 2),
            "peakReservedMiB": round(torch.cuda.max_memory_reserved() / 2**20, 2),
        }
        waveform = audio[0].float().cpu().numpy().T
        return waveform, self.metadata["sampleRate"], metrics


def encode_mp3(wav: Path, mp3: Path, bitrate: int = 320) -> dict:
    if bitrate not in (128, 192, 256, 320):
        raise ValueError("Unsupported MP3 bitrate.")
    import imageio_ffmpeg

    executable = os.environ.get("MUSIC_FFMPEG") or imageio_ffmpeg.get_ffmpeg_exe()
    temporary = mp3.with_suffix(".partial.mp3")
    # Never send prompt text through a shell; the WAV is retained on every error.
    result = subprocess.run(
        [executable, "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
         "-i", str(wav), "-map_metadata", "-1", "-codec:a", "libmp3lame",
         "-b:a", f"{bitrate}k", str(temporary)],
        capture_output=True, text=True, timeout=180, check=False,
    )
    if result.returncode or not temporary.exists() or temporary.stat().st_size == 0:
        from diagnostics import safe_error
        detail = safe_error(RuntimeError(str(result.stderr)[-4000:]))["message"]
        raise RuntimeError(f"ENCODING_FAILED (exit {result.returncode}): original WAV preserved. {detail}")
    decoded = verify_audio_file(temporary)
    temporary.replace(mp3)
    return {"filename": mp3.name, "bytes": mp3.stat().st_size, "sha256": file_hash(mp3),
            "bitrateKbps": bitrate, "decoded": decoded}


def verify_audio_file(path: Path) -> dict:
    """Decode every frame, rejecting empty, non-finite or silent output."""
    import numpy as np
    import soundfile as sf

    with sf.SoundFile(path) as stream:
        sample_rate, channels, expected = stream.samplerate, stream.channels, stream.frames
        count = 0
        squares = 0.0
        peak = 0.0
        for block in stream.blocks(blocksize=65536, dtype="float32", always_2d=True):
            if not np.isfinite(block).all():
                raise RuntimeError("DECODE_NONFINITE")
            count += len(block)
            squares += float(np.square(block, dtype=np.float64).sum())
            peak = max(peak, float(np.max(np.abs(block))))
        if count == 0 or count != expected or channels != 2 or sample_rate <= 0:
            raise RuntimeError("DECODE_INVALID_FRAMES")
        rms = math.sqrt(squares / (count * channels))
        if rms < 1e-6:
            raise RuntimeError("DECODE_SILENT")
    return {"verified": True, "frames": count, "sampleRate": sample_rate, "channels": channels,
            "duration": count / sample_rate, "rms": rms, "peak": peak}


def save_audio(waveform, sample_rate: int, path: Path) -> dict:
    import numpy as np
    import soundfile as sf

    if waveform.ndim != 2 or waveform.shape[1] != 2 or waveform.shape[0] == 0:
        raise RuntimeError("INVALID_AUDIO_SHAPE")
    if not np.isfinite(waveform).all():
        raise RuntimeError("INVALID_AUDIO_NONFINITE")
    rms = float(np.sqrt(np.mean(np.square(waveform, dtype=np.float64))))
    peak = float(np.max(np.abs(waveform)))
    if rms < 1e-6:
        raise RuntimeError("INVALID_AUDIO_SILENT")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".partial.wav")
    sf.write(temporary, waveform, sample_rate, subtype="PCM_24")
    info = sf.info(temporary)
    if info.frames != waveform.shape[0] or info.channels != 2 or info.samplerate != sample_rate:
        raise RuntimeError("WAV_VERIFICATION_FAILED")
    decoded = verify_audio_file(temporary)
    temporary.replace(path)
    return {
        "filename": path.name, "bytes": path.stat().st_size, "sha256": file_hash(path),
        "sampleRate": sample_rate, "channels": info.channels, "duration": info.duration,
        "rms": rms, "peak": peak,
        "clippedFraction": float(np.mean(np.abs(waveform) >= 0.999)),
        "decoded": decoded,
        "qualityReview": "requires-listening",
    }
